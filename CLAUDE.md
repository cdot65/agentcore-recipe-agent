# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TypeScript agent built on the [bedrock-agentcore SDK](https://github.com/aws/bedrock-agentcore-sdk-typescript) — deployed to AWS with VM-level isolation via Amazon Bedrock AgentCore.

## Project Structure

```
src/
  app.ts          Agent logic, extractJson, extractUrl, processHandler
  main.ts         Bootstrap (Secrets Manager fetch) → dynamic import app → app.run()
  lib/
    cloudwatch-stream.ts  CloudWatch Logs streaming (createCloudWatchStream, createTeeStream)
    airs-scanner.ts     AIRS SDK integration (preScan, postScan, airsEnabled)
  schemas/
    recipe.ts     Zod schemas (IngredientSchema, RecipeSchema) + types
  tools/
    fetch-url.ts  fetch_url tool: HTTP fetch, HTML parsing, JSON-LD extraction
tests/
  unit/           Schema, extractJson, fetch-url, cloudwatch-stream, airs-scanner tests
  integration/    processHandler tests (mocked Agent + BedrockAgentCoreApp)
scripts/
  deploy.sh             First deploy + update AgentCore runtime
  setup-github-iam.sh   Create IAM role for GitHub Actions OIDC
docs/
  deployment-guide/     9-part MkDocs deployment guide (Parts 01–09)
.githooks/
  pre-commit      Runs typecheck → lint → test
.github/
  workflows/
    ci.yml        GitHub Actions CI on PR/push to main
    deploy.yml    Build → ECR push → AgentCore update on push to main
```

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

This project uses a non-streaming handler returning a typed Recipe JSON object. Request accepts `{"url": "..."}` or `{"prompt": "natural language with URL"}` (URL extracted via regex).

App logic lives in `src/app.ts` (testable exports); `src/main.ts` is the thin entry point.

### Request Flow

1. Parse URL from `request.url` or extract from `request.prompt`
2. (Optional) AIRS prompt pre-scan — block if flagged
3. Invoke Strands Agent with `fetch_url` tool → LLM extracts structured recipe
4. Parse agent response via `extractJson` → validate with `RecipeSchema`
5. (Optional) AIRS response post-scan — block if flagged
6. Return typed `Recipe` object

## Key Dependencies

- `bedrock-agentcore` — runtime server (Fastify on :8080), requires Node.js 20+
- `@strands-agents/sdk` — agent framework (Agent, BedrockModel, tool)
- `@cdot65/prisma-airs-sdk` — AI security scanning (prompt/response threat detection)
- `zod` ^4 — request/response schema validation
- `linkedom` — lightweight HTML parser (~200KB vs jsdom 70MB)

## SDK Overview

Single npm package: `bedrock-agentcore`

Import paths:
- `bedrock-agentcore/runtime` — `BedrockAgentCoreApp`, `RuntimeClient`, `RequestContext`
- `bedrock-agentcore/identity` — `withAccessToken()`, `withApiKey()` (OAuth2/API key HOFs)
- `bedrock-agentcore/code-interpreter` — sandboxed code execution
- `bedrock-agentcore/browser` — cloud browser automation
- `bedrock-agentcore/browser/playwright` — Playwright integration

## Common Commands

```bash
npm test                          # run all tests
npm run test:watch                # watch mode
npx vitest run tests/unit/extract-json.test.ts  # single test file
npm run test:coverage             # tests + coverage (100% thresholds enforced)
npm run typecheck                 # tsc --noEmit
npm run check                     # biome lint + format check
npm run check:fix                 # auto-fix lint + format
npm run build                     # tsc → dist/
npm run dev                       # tsx with .env hot reload
```

## Dev Tooling

- `vitest` — test framework, 100% coverage enforced via v8 thresholds (statements/branches/functions/lines)
- `@biomejs/biome` — linting + formatting (single tool, zero plugins)
- `typescript` — strict mode, `tsc --noEmit` for type checking
- Pre-commit hook: `.githooks/pre-commit` runs typecheck → biome check → vitest
- CI: `.github/workflows/ci.yml` runs same checks on PR/push to main

## Environment Variables

- `PANW_AI_SEC_API_KEY` + `PRISMA_AIRS_PROFILE_NAME` — enables AIRS security scanning (both required)
- `AWS_REGION` — defaults to `us-west-2`
- `BEDROCK_AGENT_ID` — enables CloudWatch log streaming when set

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
