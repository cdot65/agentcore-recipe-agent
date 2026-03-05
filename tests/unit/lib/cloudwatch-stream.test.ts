import { Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
}));

vi.mock("@aws-sdk/client-cloudwatch-logs", () => ({
  CloudWatchLogsClient: class {
    send = mockSend;
  },
  CreateLogStreamCommand: class {
    constructor(public input: unknown) {}
  },
  PutLogEventsCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { createCloudWatchStream, createTeeStream } from "../../../src/lib/cloudwatch-stream.js";

describe("createCloudWatchStream", () => {
  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue({});
  });

  it("creates a Writable stream", () => {
    const stream = createCloudWatchStream("/test/log-group", "us-west-2");
    expect(stream).toBeInstanceOf(Writable);
    stream.destroy();
  });

  it("batches and flushes on stream end", async () => {
    const stream = createCloudWatchStream("/test/log-group", "us-west-2");

    stream.write('{"level":30,"msg":"hello"}\n');
    stream.write('{"level":30,"msg":"world"}\n');

    await new Promise<void>((resolve, reject) => {
      stream.end((err: Error | null) => (err ? reject(err) : resolve()));
    });

    // CreateLogStream + PutLogEvents
    expect(mockSend).toHaveBeenCalledTimes(2);
    const putCmd = mockSend.mock.calls[1][0];
    expect(putCmd.input.logEvents).toHaveLength(2);
    expect(putCmd.input.logEvents[0].message).toBe('{"level":30,"msg":"hello"}');
    expect(putCmd.input.logGroupName).toBe("/test/log-group");
  });

  it("creates log stream only once", async () => {
    const stream = createCloudWatchStream("/test/log-group", "us-west-2");

    stream.write("line1\n");

    // Trigger a flush via end
    await new Promise<void>((resolve, reject) => {
      stream.end((err: Error | null) => (err ? reject(err) : resolve()));
    });

    const createCalls = mockSend.mock.calls.filter(
      (c) => c[0].constructor.name === "CreateLogStreamCommand",
    );
    expect(createCalls).toHaveLength(1);
  });

  it("flushes when batch reaches MAX_BATCH (100)", async () => {
    const stream = createCloudWatchStream("/test/log-group", "us-west-2");

    const writes: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      writes.push(
        new Promise<void>((resolve, reject) => {
          stream.write(`line-${i}\n`, (err) => (err ? reject(err) : resolve()));
        }),
      );
    }
    await Promise.all(writes);

    // Should have flushed: CreateLogStream + PutLogEvents
    expect(mockSend).toHaveBeenCalledTimes(2);

    await new Promise<void>((resolve, reject) => {
      stream.end((err: Error | null) => (err ? reject(err) : resolve()));
    });
  });

  it("handles flush errors gracefully", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mockSend.mockRejectedValue(new Error("CW unavailable"));

    const stream = createCloudWatchStream("/test/log-group", "us-west-2");
    stream.write("test\n");

    await new Promise<void>((resolve, reject) => {
      stream.end((err: Error | null) => (err ? reject(err) : resolve()));
    });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("flush failed"));
    stdoutSpy.mockRestore();
  });

  it("skips empty messages", async () => {
    const stream = createCloudWatchStream("/test/log-group", "us-west-2");

    await new Promise<void>((resolve, reject) => {
      stream.write("\n", (err) => (err ? reject(err) : resolve()));
    });

    await new Promise<void>((resolve, reject) => {
      stream.end((err: Error | null) => (err ? reject(err) : resolve()));
    });

    // No CW calls since only empty message + empty flush
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips CreateLogStream on subsequent flushes", async () => {
    vi.useFakeTimers();
    const stream = createCloudWatchStream("/test/log-group", "us-west-2");

    stream.write("line1\n");
    await vi.advanceTimersByTimeAsync(1_000);

    stream.write("line2\n");
    await vi.advanceTimersByTimeAsync(1_000);

    const createCalls = mockSend.mock.calls.filter(
      (c) => c[0].constructor.name === "CreateLogStreamCommand",
    );
    expect(createCalls).toHaveLength(1);
    // Two PutLogEvents calls
    const putCalls = mockSend.mock.calls.filter(
      (c) => c[0].constructor.name === "PutLogEventsCommand",
    );
    expect(putCalls).toHaveLength(2);

    stream.destroy();
    vi.useRealTimers();
  });

  it("flushes periodically via interval", async () => {
    vi.useFakeTimers();
    const stream = createCloudWatchStream("/test/log-group", "us-west-2");

    stream.write("line1\n");
    expect(mockSend).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    // CreateLogStream + PutLogEvents
    expect(mockSend).toHaveBeenCalledTimes(2);

    stream.destroy();
    vi.useRealTimers();
  });
});

describe("createTeeStream", () => {
  it("writes to all underlying streams", async () => {
    const chunks1: string[] = [];
    const chunks2: string[] = [];

    const s1 = new Writable({
      write(chunk, _enc, cb) {
        chunks1.push(chunk.toString());
        cb();
      },
    });
    const s2 = new Writable({
      write(chunk, _enc, cb) {
        chunks2.push(chunk.toString());
        cb();
      },
    });

    const tee = createTeeStream(s1, s2);
    tee.write("hello");

    await new Promise<void>((resolve, reject) => {
      tee.end((err: Error | null) => (err ? reject(err) : resolve()));
    });

    expect(chunks1).toEqual(["hello"]);
    expect(chunks2).toEqual(["hello"]);
  });

  it("propagates errors from underlying streams", async () => {
    const failing = new Writable({
      write(_chunk, _enc, cb) {
        cb(new Error("write failed"));
      },
    });
    failing.on("error", () => {}); // prevent uncaught exception

    const ok = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });

    const tee = createTeeStream(ok, failing);
    tee.on("error", () => {}); // prevent uncaught exception

    await new Promise<void>((resolve) => {
      tee.write("test", (err) => {
        expect(err?.message).toBe("write failed");
        resolve();
      });
    });

    tee.destroy();
  });

  it("propagates errors from underlying stream final", async () => {
    const s1 = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
      final(cb) {
        cb(new Error("final failed"));
      },
    });
    s1.on("error", () => {}); // prevent uncaught exception
    const s2 = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
      final(cb) {
        cb();
      },
    });

    const tee = createTeeStream(s1, s2);
    tee.on("error", () => {}); // prevent uncaught exception

    await expect(
      new Promise<void>((resolve, reject) => {
        tee.end((err: Error | null) => (err ? reject(err) : resolve()));
      }),
    ).rejects.toThrow("final failed");
  });

  it("calls end on all underlying streams in final", async () => {
    const ended: string[] = [];

    const s1 = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
      final(cb) {
        ended.push("s1");
        cb();
      },
    });
    const s2 = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
      final(cb) {
        ended.push("s2");
        cb();
      },
    });

    const tee = createTeeStream(s1, s2);

    await new Promise<void>((resolve, reject) => {
      tee.end((err: Error | null) => (err ? reject(err) : resolve()));
    });

    expect(ended).toContain("s1");
    expect(ended).toContain("s2");
  });
});
