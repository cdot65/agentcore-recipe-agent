# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TypeScript agent built on the [bedrock-agentcore SDK](https://github.com/aws/bedrock-agentcore-sdk-typescript) — deployed to AWS with VM-level isolation via Amazon Bedrock AgentCore.

## SDK Overview

Single npm package: `bedrock-agentcore` (requires Node.js 20+)

Import paths:
- `bedrock-agentcore/runtime` — `BedrockAgentCoreApp`, `RuntimeClient`, `RequestContext`
- `bedrock-agentcore/identity` — `withAccessToken()`, `withApiKey()` (OAuth2/API key HOFs)
- `bedrock-agentcore/code-interpreter` — sandboxed code execution
- `bedrock-agentcore/browser` — cloud browser automation
- `bedrock-agentcore/browser/playwright` — Playwright integration
- `bedrock-agentcore/experimental/code-interpreter/strands` — Strands SDK integration
- `bedrock-agentcore/experimental/browser/strands` — Strands SDK integration

## Architecture Pattern

```
BedrockAgentCoreApp (Fastify on :8080)
  ├── GET /ping          — health check
  ├── POST /invocations  — agent invocation (JSON or SSE streaming)
  └── /ws                — WebSocket (optional)

Handler types:
  - Return object        → JSON response
  - async function*      → SSE streaming (yield events, auto-closes with event:done)
```

Canonical pattern: define tools → create Agent → wrap in `BedrockAgentCoreApp` with streaming handler.

```typescript
import { Agent, BedrockModel, tool } from '@strands-agents/sdk'
import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime'
import { z } from 'zod'

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: z.object({ prompt: z.string() }),
    process: async function* (request, context) {
      // context: sessionId, headers, workloadAccessToken, requestId, logger
      for await (const event of agent.stream(request.prompt)) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta?.type === 'textDelta') {
          yield { event: 'message', data: { text: event.delta.text } }
        }
      }
    },
  },
})
app.run()
```

## Key Dependencies

- `bedrock-agentcore` — core SDK
- `@strands-agents/sdk` — agent framework (Agent, BedrockModel, tool)
- `zod` ^4 — request schema validation
- `@aws-sdk/client-bedrock-agentcore` — underlying AWS SDK (pulled in transitively)

## Identity SDK

`withAccessToken()` and `withApiKey()` are HOFs that inject credentials into wrapped functions:

```typescript
const fn = withAccessToken({
  workloadIdentityToken: context.workloadAccessToken!,
  providerName: 'github',
  scopes: ['repo'],
  authFlow: 'M2M',  // or 'USER_FEDERATION'
})(async (query, token) => { /* use token */ })
```

## Reference

- SDK repo: https://github.com/aws/bedrock-agentcore-sdk-typescript
- Samples: https://github.com/awslabs/bedrock-agentcore-samples-typescript
