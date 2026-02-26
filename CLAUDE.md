# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TypeScript agent built on the [bedrock-agentcore SDK](https://github.com/aws/bedrock-agentcore-sdk-typescript) — deployed to AWS with VM-level isolation via Amazon Bedrock AgentCore.

## Project Structure

```
src/
  app.ts          Agent logic, extractJson, processHandler (all exports)
  main.ts         Entry point (imports app, calls app.run())
  schemas/
    recipe.ts     Zod schemas (IngredientSchema, RecipeSchema) + types
  tools/
    fetch-url.ts  fetch_url tool: HTTP fetch, HTML parsing, JSON-LD extraction
tests/
  unit/           Schema, extractJson, fetch-url tests
  integration/    processHandler tests (mocked Agent + BedrockAgentCoreApp)
.githooks/
  pre-commit      Runs typecheck → lint → test
.github/
  workflows/
    ci.yml        GitHub Actions CI on PR/push to main
```

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

This project uses a non-streaming handler that returns a typed Recipe JSON object. The app logic lives in `src/app.ts` (testable exports); `src/main.ts` is the entry point that calls `app.run()`.

```typescript
// src/app.ts — exports agent, extractJson, processHandler, app
import { Agent, BedrockModel } from '@strands-agents/sdk'
import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime'
import { z } from 'zod'

export const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: z.object({ url: z.string().url() }),
    process: processHandler,  // exported separately for testing
  },
})

// src/main.ts — entry point
import { app } from './app.js'
app.run()
```

## Key Dependencies

- `bedrock-agentcore` — runtime server (Fastify on :8080)
- `@strands-agents/sdk` — agent framework (Agent, BedrockModel, tool)
- `zod` ^4 — request/response schema validation
- `linkedom` — lightweight HTML parser (~200KB vs jsdom 70MB)
- `@aws-sdk/client-bedrock-agentcore` — underlying AWS SDK (pulled in transitively)

## Dev Tooling

- `vitest` — test framework (71 tests, 100% coverage enforced via v8 thresholds)
- `@biomejs/biome` — linting + formatting (single tool, zero plugins)
- `typescript` — strict mode, `tsc --noEmit` for type checking
- Pre-commit hook: `.githooks/pre-commit` runs typecheck → biome check → vitest
- CI: `.github/workflows/ci.yml` runs same checks on PR/push to main

## Common Commands

```bash
npm test              # run tests
npm run test:coverage # tests + coverage report
npm run typecheck     # tsc --noEmit
npm run check         # biome lint + format
npm run check:fix     # auto-fix lint + format
npm run build         # tsc → dist/
npm run dev           # tsx src/main.ts (hot reload)
```

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
