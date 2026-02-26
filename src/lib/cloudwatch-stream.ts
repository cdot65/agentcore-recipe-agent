import { hostname } from "node:os";
import { Writable } from "node:stream";
import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

const MAX_BATCH = 100;
const FLUSH_INTERVAL_MS = 1_000;

export function createCloudWatchStream(logGroupName: string, region: string): Writable {
  const client = new CloudWatchLogsClient({ region });
  const logStreamName = `${hostname()}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let streamCreated = false;
  let buffer: Array<{ timestamp: number; message: string }> = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  async function ensureStream() {
    if (streamCreated) return;
    await client.send(new CreateLogStreamCommand({ logGroupName, logStreamName }));
    streamCreated = true;
  }

  async function flush() {
    if (buffer.length === 0) return;
    const events = buffer;
    buffer = [];
    try {
      await ensureStream();
      await client.send(
        new PutLogEventsCommand({ logGroupName, logStreamName, logEvents: events }),
      );
    } catch (err) {
      process.stdout.write(`[cloudwatch-stream] flush failed: ${err}\n`);
    }
  }

  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const message = chunk.toString().trimEnd();
      if (!message) return callback();

      buffer.push({ timestamp: Date.now(), message });

      if (!timer) {
        timer = setInterval(() => {
          flush();
        }, FLUSH_INTERVAL_MS);
        timer.unref();
      }

      if (buffer.length >= MAX_BATCH) {
        flush().then(() => callback(), callback);
      } else {
        callback();
      }
      return true;
    },
    final(callback) {
      if (timer) clearInterval(timer);
      flush().then(() => callback(), callback);
    },
  });

  return stream;
}

export function createTeeStream(...streams: Writable[]): Writable {
  return new Writable({
    write(chunk, encoding, callback) {
      let pending = streams.length;
      let error: Error | null = null;
      for (const s of streams) {
        s.write(chunk, encoding, (err) => {
          if (err && !error) error = err;
          if (--pending === 0) callback(error);
        });
      }
      return true;
    },
    final(callback) {
      let pending = streams.length;
      let error: Error | null = null;
      for (const s of streams) {
        s.end((err: Error | null) => {
          if (err && !error) error = err;
          if (--pending === 0) callback(error);
        });
      }
    },
  });
}
