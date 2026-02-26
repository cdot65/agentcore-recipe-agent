# Part 3: Security with Prisma AIRS

[<- Back to Index](./README.md) | [Previous: Architecture](./02-agent-architecture-deep-dive.md) | [Next: Observability ->](./04-observability-cloudwatch-logs.md)

---

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

## The PrismaAIRSClient

The client lives in `src/lib/airs-api-client.ts`. It's a focused class with four public methods.

### Constructor

```typescript
// src/lib/airs-api-client.ts
export class PrismaAIRSClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly profileName: string;
  private readonly logger: Logger;

  constructor(config?: {
    apiUrl?: string;
    apiKey?: string;
    profileName?: string;
    logger?: Logger;
  }) {
    this.apiUrl =
      config?.apiUrl ||
      process.env.PRISMA_AIRS_API_URL ||
      "https://service.api.aisecurity.paloaltonetworks.com/v1/scan/sync/request";
    this.apiKey = config?.apiKey || process.env.PRISMA_AIRS_API_KEY || "";
    this.profileName = config?.profileName || process.env.PRISMA_AIRS_PROFILE_NAME || "";
    this.logger = config?.logger || console;
  }
```

Configuration cascades: explicit config > env vars > defaults. The API URL defaults to the Prisma AIRS production endpoint.

### `isEnabled()`

```typescript
  isEnabled(): boolean {
    return Boolean(this.apiKey && this.profileName);
  }
```

Returns `true` only when both API key and profile name are set. This enables **fail-open design** — if AIRS isn't configured, the agent operates normally without security scanning.

### `scanPrompt()` — Pre-LLM Gate

```typescript
  async scanPrompt(
    prompt: string,
    metadata?: { sessionId?: string; appUser?: string },
  ): Promise<AIRSScanResponse | null> {
    if (!this.apiKey) return null;

    const request: AIRSScanRequest = {
      tr_id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
      session_id: metadata?.sessionId,
      ai_profile: { profile_name: this.profileName },
      metadata: this.buildMetadata(metadata?.appUser),
      contents: [{ prompt }],
    };

    return this.send(request);
  }
```

Called **before** the LLM invocation. Sends only the `prompt` field in `contents`. If AIRS returns `action: "block"`, the agent short-circuits and never calls Bedrock.

### `scanResponse()` — Post-LLM Gate

```typescript
  async scanResponse(
    response: string,
    originalPrompt: string,
    metadata?: { sessionId?: string; appUser?: string },
  ): Promise<AIRSScanResponse | null> {
    if (!this.apiKey) return null;

    const request: AIRSScanRequest = {
      tr_id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
      session_id: metadata?.sessionId,
      ai_profile: { profile_name: this.profileName },
      metadata: this.buildMetadata(metadata?.appUser),
      contents: [{ prompt: originalPrompt, response }],
    };

    return this.send(request);
  }
```

Called **after** the LLM produces output, but **before** it's returned to the client. Sends both the original prompt and the response for context-aware analysis.

### `buildMetadata()` — Agent Discovery

```typescript
  private buildMetadata(appUser?: string): AIRSScanRequest["metadata"] {
    const agentId = process.env.BEDROCK_AGENT_ID;
    const region = process.env.AWS_REGION || "us-west-2";
    const accountId = process.env.AWS_ACCOUNT_ID;

    return {
      app_name: "recipe-extraction-agent",
      app_user: appUser || "anonymous",
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

This populates AWS agent metadata in every scan request. When `BEDROCK_AGENT_ID` is set (after deployment), the AIRS dashboard can link scan results back to the specific AgentCore runtime.

### `send()` — HTTP Transport

```typescript
  private async send(request: AIRSScanRequest): Promise<AIRSScanResponse | null> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "x-pan-token": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        this.logger.error(`AIRS API error: ${response.status} ${response.statusText}`);
        return null;
      }

      return (await response.json()) as AIRSScanResponse;
    } catch (error) {
      this.logger.error("AIRS API request failed:", error);
      return null;
    }
  }
```

**Fail-open on errors:** If the AIRS API is unreachable or returns an error, the method returns `null` and the agent continues. This prevents a third-party service outage from taking down your agent.

## Integration in processHandler

The AIRS checks are wired into the request handler in `src/app.ts`:

```typescript
// src/app.ts — processHandler (simplified)
const airsClient = new PrismaAIRSClient();

export const processHandler = async (request, context) => {
  const prompt = `Extract the recipe from this URL: ${request.url}`;
  const scanMeta = { sessionId: context.sessionId };

  // PRE-SCAN: check inbound prompt
  if (airsClient.isEnabled()) {
    const promptScan = await airsClient.scanPrompt(prompt, scanMeta);
    context.log.info({ action: promptScan?.action, scanId: promptScan?.scan_id }, "AIRS prompt scan");

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
  if (airsClient.isEnabled()) {
    const responseScan = await airsClient.scanResponse(JSON.stringify(recipe), prompt, scanMeta);
    context.log.info({ action: responseScan?.action, scanId: responseScan?.scan_id }, "AIRS response scan");

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

## Request/Response Interfaces

```typescript
// src/lib/airs-api-client.ts

export interface AIRSScanRequest {
  tr_id: string;
  session_id?: string;
  ai_profile: { profile_name: string };
  metadata?: {
    app_name?: string;
    app_user?: string;
    ai_model?: string;
    agent_meta?: {
      agent_id?: string;
      agent_version?: string;
      agent_arn?: string;
    };
  };
  contents: Array<{ prompt?: string; response?: string }>;
}

export interface AIRSScanResponse {
  action: "allow" | "block";
  category: string;
  profile_id: string;
  profile_name: string;
  prompt_detected?: AIRSDetectionFlags;
  response_detected?: AIRSDetectionFlags;
  report_id?: string;
  scan_id: string;
  tr_id: string;
}
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PRISMA_AIRS_API_KEY` | No | API key for authentication. Fetched from Secrets Manager in prod. |
| `PRISMA_AIRS_PROFILE_NAME` | No | Name of the AIRS security profile to use |
| `PRISMA_AIRS_API_URL` | No | Override the default API endpoint |
| `BEDROCK_AGENT_ID` | No | AgentCore runtime ID (set after deployment, used in metadata) |
| `BEDROCK_AGENT_VERSION` | No | Agent version (defaults to "1") |
| `AWS_ACCOUNT_ID` | No | Used to construct the agent ARN in metadata |

All are optional. If `PRISMA_AIRS_API_KEY` and `PRISMA_AIRS_PROFILE_NAME` are not set, AIRS is completely disabled and the agent handles requests without scanning.

---

[Next: Observability: CloudWatch Logs ->](./04-observability-cloudwatch-logs.md)
