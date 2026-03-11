# Part 3: Security with Prisma AIRS


## Why AI Runtime Security?

AI agents introduce a new class of security risks that traditional WAFs and API gateways don't cover:

| Threat | Description |
|---|---|
| **Prompt injection** | Malicious input that tricks the LLM into ignoring its instructions |
| **Data exfiltration** | Prompts designed to extract training data or system prompts |
| **Toxic content** | LLM generates harmful, offensive, or inappropriate output |
| **DLP violations** | Sensitive data (PII, credentials) in prompts or responses |
| **Malicious URLs** | Input URLs that point to phishing, malware, or exploit pages |

These threats need to be checked **at the AI layer** — both before the prompt reaches the LLM and after the response is generated.

## Prisma AIRS Overview

[Prisma AIRS](https://www.paloaltonetworks.com/blog/prisma-cloud/ai-runtime-security/) (AI Runtime Security) by Palo Alto Networks provides a synchronous scan API that inspects prompts and responses in real time. It checks for:

- Prompt injection attacks
- DLP policy violations
- Toxic/harmful content
- Malicious URLs and code
- Custom policy rules (configured per profile)

The integration point is simple: a REST API call before and after LLM invocation.

### Getting Started with Prisma AIRS

1. Sign up at [Palo Alto Networks](https://www.paloaltonetworks.com/prisma/cloud) for Prisma Cloud access
2. Navigate to **AI Runtime Security** in the Prisma Cloud console
3. Create a security **profile** — this defines which checks are active and their thresholds
4. Generate an **API key** for programmatic access

For detailed setup instructions, refer to the [Prisma AIRS documentation](https://docs.paloaltonetworks.com/ai-runtime-security).

## The `@cdot65/prisma-airs-sdk`

This project uses the [`@cdot65/prisma-airs-sdk`](https://www.npmjs.com/package/@cdot65/prisma-airs-sdk) — a TypeScript SDK for Palo Alto Networks AI Runtime Security that mirrors the official Python SDK.

### Installation

```bash
npm install @cdot65/prisma-airs-sdk
```

### SDK Initialization

The SDK uses a global `init()` function to configure credentials:

```typescript
import { init, Scanner, Content } from '@cdot65/prisma-airs-sdk';

// Initialize with API key (or set PANW_AI_SEC_API_KEY env var)
init({ apiKey: 'your-api-key' });

const scanner = new Scanner();
```

### Scanning

The `Scanner` class provides `syncScan()` for real-time prompt and response scanning:

```typescript
const result = await scanner.syncScan(
  { profile_name: 'my-profile' },
  new Content({ prompt: 'user input' }),
  {
    sessionId: 'session-123',
    metadata: {
      app_name: 'my-agent',
      ai_model: 'claude-haiku-4.5',
    },
  },
);

console.log(result.action);   // "allow" | "block"
console.log(result.category); // "benign" | "prompt_injection" | ...
```

For response scanning, pass both the prompt and response:

```typescript
const result = await scanner.syncScan(
  { profile_name: 'my-profile' },
  new Content({ prompt: 'user input', response: 'model output' }),
  { sessionId: 'session-123', metadata },
);
```

### Error Handling

The SDK throws `AISecSDKException` with a typed `errorType` field:

```typescript
import { AISecSDKException } from '@cdot65/prisma-airs-sdk';

try {
  await scanner.syncScan(profile, content);
} catch (err) {
  if (err instanceof AISecSDKException) {
    console.error(err.errorType); // e.g. "AISEC_SERVER_SIDE_ERROR"
  }
}
```

Error types: `SERVER_SIDE_ERROR`, `CLIENT_SIDE_ERROR`, `USER_REQUEST_PAYLOAD_ERROR`, `MISSING_VARIABLE`, `AISEC_SDK_ERROR`, `OAUTH_ERROR`.

## Integration in the Agent

The AIRS integration is wired directly into `src/app.ts` using the SDK.

### Initialization

```typescript
// src/app.ts
import {
  AISecSDKException,
  Content,
  init,
  Scanner,
  type ScanResponse,
} from "@cdot65/prisma-airs-sdk";

const airsApiKey = process.env.PANW_AI_SEC_API_KEY || "";
const airsProfileName = process.env.PRISMA_AIRS_PROFILE_NAME || "";
export const airsEnabled = Boolean(airsApiKey && airsProfileName);

if (airsEnabled) {
  init({ apiKey: airsApiKey });
}

const scanner = airsEnabled ? new Scanner() : null;
```

**Fail-open design:** If `PANW_AI_SEC_API_KEY` or `PRISMA_AIRS_PROFILE_NAME` are not set, `scanner` is `null` and all scanning is skipped. The agent operates normally without security scanning.

### Metadata Builder

Every scan request includes agent metadata for traceability in the AIRS dashboard:

```typescript
function buildMetadata() {
  const agentId = process.env.BEDROCK_AGENT_ID;
  const region = process.env.AWS_REGION || "us-west-2";
  const accountId = process.env.AWS_ACCOUNT_ID;

  return {
    app_name: "recipe-extraction-agent",
    app_user: "anonymous",
    ai_model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    agent_meta: agentId
      ? {
          agent_id: agentId,
          agent_version: process.env.BEDROCK_AGENT_VERSION || "1",
          agent_arn: accountId
            ? `arn:aws:bedrock:${region}:${accountId}:agent/${agentId}`
            : undefined,
        }
      : undefined,
  };
}
```

When `BEDROCK_AGENT_ID` is set (after deployment), the AIRS dashboard can link scan results back to the specific AgentCore runtime.

### Request Handler Integration

```typescript
// src/app.ts — processHandler (simplified)
export const processHandler = async (request, context) => {
  const prompt = `Extract the recipe from this URL: ${request.url}`;

  // PRE-SCAN: check inbound prompt
  if (scanner) {
    const metadata = buildMetadata();
    let promptScan: ScanResponse | undefined;
    try {
      promptScan = await scanner.syncScan(
        { profile_name: airsProfileName },
        new Content({ prompt }),
        { sessionId: context.sessionId, metadata },
      );
    } catch (err) {
      // Simplified — actual code includes scanErrorFields(err) and durationMs
      context.log.error({ err }, "AIRS prompt scan failed, proceeding unscanned");
    }

    if (promptScan?.action === "block") {
      return {
        error: "blocked",
        message: "Request blocked by Prisma AIRS security.",
        category: promptScan.category,
        scan_id: promptScan.scan_id,
      };
    }
  }

  // ... agent invocation, JSON parsing, Zod validation ...

  // POST-SCAN: check outbound response
  if (scanner) {
    let responseScan: ScanResponse | undefined;
    try {
      responseScan = await scanner.syncScan(
        { profile_name: airsProfileName },
        new Content({ prompt, response: JSON.stringify(recipe) }),
        { sessionId: context.sessionId, metadata: buildMetadata() },
      );
    } catch (err) {
      // Simplified — actual code includes scanErrorFields(err) and durationMs
      context.log.error({ err }, "AIRS response scan failed, proceeding unscanned");
    }

    if (responseScan?.action === "block") {
      return {
        error: "blocked",
        message: "Response blocked by Prisma AIRS security.",
        category: responseScan.category,
        scan_id: responseScan.scan_id,
      };
    }
  }

  return recipe;
};
```

### Block Response Shape

When AIRS blocks a request, the agent returns:

```json
{
  "error": "blocked",
  "message": "Request blocked by Prisma AIRS security.",
  "category": "prompt_injection",
  "scan_id": "abc123-..."
}
```

The `category` field tells the client *why* it was blocked. The `scan_id` can be used to look up details in the Prisma AIRS dashboard.

## Debug Logging

Every scan produces comprehensive debug logs visible in CloudWatch:

| Log Message | Fields |
|---|---|
| `AIRS SDK status` | `airsEnabled`, `airsProfileName` |
| `AIRS prompt scan starting` | `promptLength`, `profileName`, `metadata` (includes `agent_meta`) |
| `AIRS prompt scan complete` | `action`, `category`, `scanId`, `reportId`, `profileId`, `profileName`, `trId`, `promptDetected`, `responseDetected`, `durationMs` |
| `AIRS prompt scan failed, proceeding unscanned` | `err`, `errorType` (if `AISecSDKException`), `durationMs` |
| `AIRS response scan starting` | `promptLength`, `responseLength`, `profileName`, `metadata` |
| `AIRS response scan complete` | Same fields as prompt scan complete + `durationMs` |
| `AIRS response scan failed, proceeding unscanned` | Same fields as prompt scan failed |

Example CloudWatch log entry:

```json
{
  "level": 30,
  "time": 1772756869372,
  "action": "allow",
  "category": "benign",
  "scanId": "0be93d6b-cc74-435f-b19b-c6b861cc927f",
  "reportId": "R0be93d6b-cc74-435f-b19b-c6b861cc927f",
  "profileId": "2225ece2-0cc3-4235-affe-78f9433a3da3",
  "profileName": "Recipe Extractor AWS Agent",
  "promptDetected": {
    "agent": false,
    "injection": false,
    "toxic_content": false,
    "url_cats": false
  },
  "durationMs": 441,
  "msg": "AIRS prompt scan complete"
}
```

## Secret Management

The AIRS API key is stored in AWS Secrets Manager — never baked into the Docker image or passed as a plain environment variable.

At runtime, `src/main.ts` fetches the secret during bootstrap **before** importing the app module:

```typescript
// src/main.ts
async function bootstrap() {
  if (!process.env.PANW_AI_SEC_API_KEY) {
    try {
      const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-west-2" });
      const secret = await sm.send(
        new GetSecretValueCommand({ SecretId: "recipe-agent/prisma-airs-api-key" }),
      );
      if (secret.SecretString) {
        process.env.PANW_AI_SEC_API_KEY = secret.SecretString;
      }
    } catch {
      console.warn("Secrets Manager unavailable, using env var for PANW_AI_SEC_API_KEY");
    }
  }

  // Dynamic import ensures init() in app.ts sees the env var
  const { app } = await import("./app.js");
  app.run();
}
```

The dynamic import is critical: `app.ts` runs `init()` at module load time, so the API key must be in the environment *before* the import.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PANW_AI_SEC_API_KEY` | No | API key for authentication. Fetched from Secrets Manager in prod. |
| `PRISMA_AIRS_PROFILE_NAME` | No | Name of the AIRS security profile to use |
| `BEDROCK_AGENT_ID` | No | AgentCore runtime ID (set after deployment, used in metadata) |
| `BEDROCK_AGENT_VERSION` | No | Agent version (defaults to "1") |
| `AWS_ACCOUNT_ID` | No | Used to construct the agent ARN in metadata |

All are optional. If `PANW_AI_SEC_API_KEY` and `PRISMA_AIRS_PROFILE_NAME` are not set, AIRS is completely disabled and the agent handles requests without scanning.

