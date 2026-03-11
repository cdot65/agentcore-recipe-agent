# Part 4: Observability — CloudWatch Logs


## Why Custom Log Shipping?

AgentCore runs your container in a VM-isolated environment, but it **doesn't automatically ship container stdout to CloudWatch**. If your agent crashes or behaves unexpectedly in production, you need logs — and you need them somewhere persistent.

This project ships logs to CloudWatch Logs using a custom Writable stream that integrates with Pino (the logger built into BedrockAgentCoreApp's Fastify server).

## Architecture

```
Pino logger
  └─→ createTeeStream()
        ├─→ process.stdout        (local visibility)
        └─→ createCloudWatchStream()
              ├─→ buffer (100 events or 1s)
              └─→ PutLogEvents → CloudWatch Logs
```

Locally (`BEDROCK_AGENT_ID` not set): logs go to stdout only.
In AgentCore (`BEDROCK_AGENT_ID` set): logs go to both stdout and CloudWatch.

## The CloudWatch Stream

The full implementation in `src/lib/cloudwatch-stream.ts`:

```typescript
// src/lib/cloudwatch-stream.ts
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
```

### How It Works

1. **Log stream naming** — Each container instance gets a unique log stream: `{hostname}-{ISO timestamp}`. This prevents conflicts when multiple instances run.

2. **Lazy stream creation** — The CloudWatch log stream is created on first write (`ensureStream()`), not at startup. This avoids errors if the log group doesn't exist yet.

3. **Batching** — Events are buffered and flushed when either:
   - The buffer reaches 100 events (`MAX_BATCH`)
   - 1 second has elapsed (`FLUSH_INTERVAL_MS`)

4. **Non-blocking timer** — `timer.unref()` prevents the flush interval from keeping the process alive during shutdown.

5. **Error fallback** — If CloudWatch is unreachable, errors are written to stdout and the agent continues operating.

## The Tee Stream

To send logs to both stdout and CloudWatch simultaneously:

```typescript
// src/lib/cloudwatch-stream.ts
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
```

This writes each chunk to all streams in parallel and waits for all to complete before acknowledging.

## Wiring It Up

The conditional wiring in `src/app.ts`:

```typescript
// src/app.ts
const LOG_GROUP = "/aws/bedrock/agentcore/recipe-extraction-agent";
const region = process.env.AWS_REGION || "us-west-2";

const logStream = process.env.BEDROCK_AGENT_ID
  ? createTeeStream(process.stdout, createCloudWatchStream(LOG_GROUP, region))
  : process.stdout;
```

Then passed to the app:

```typescript
// src/app.ts
export const app = new BedrockAgentCoreApp({
  config: { logging: { options: { stream: logStream } } },
  invocationHandler: {
    requestSchema: z.object({
      url: z.string().url().describe("URL of the recipe page to extract").optional(),
      prompt: z.string().describe("Natural language prompt containing a recipe URL").optional(),
    }),
    process: processHandler,
  },
});
```

`config.logging.options.stream` is piped directly to Pino — BedrockAgentCoreApp uses Pino under the hood via Fastify.

## IAM Permissions

The execution role needs CloudWatch Logs permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ],
    "Resource": "arn:aws:logs:us-west-2:ACCOUNT_ID:log-group:/aws/bedrock/agentcore/recipe-extraction-agent:*"
  }]
}
```

This is automatically configured by the deploy script (see [Part 6](./06-aws-infrastructure-setup.md)).

## Viewing Logs

After deployment, view logs in the AWS Console:

1. Open [CloudWatch Logs](https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups) in `us-west-2`
2. Find log group: `/aws/bedrock/agentcore/recipe-extraction-agent`
3. Click into the latest log stream

Or via CLI:

```bash
aws logs tail "/aws/bedrock/agentcore/recipe-extraction-agent" \
  --region us-west-2 \
  --follow
```

Each log line is a Pino JSON object with fields like:

```json
{
  "level": 30,
  "time": 1706000000000,
  "msg": "Extracting recipe",
  "url": "https://pinchofyum.com/..."
}
```

