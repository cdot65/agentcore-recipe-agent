# Dependencies

## Runtime

| Package | Version | Purpose |
|---|---|---|
| `bedrock-agentcore` | ^0.2.0 | Runtime server (Fastify on :8080), request routing, SSE support |
| `@strands-agents/sdk` | ^0.4.0 | Agent framework — Agent, BedrockModel, tool decorator |
| `@cdot65/prisma-airs-sdk` | ^0.2.0 | Prisma AIRS (Strata Cloud Manager) — AI runtime security for prompt injection, URL categorization, DLP, agent security |
| `zod` | ^4.1.12 | Request/response schema validation |
| `linkedom` | ^0.18.0 | Lightweight HTML parser (~200KB vs jsdom's 70MB) |
| `@aws-sdk/client-cloudwatch-logs` | ^3.1002.0 | CloudWatch Logs PutLogEvents for custom log streaming |
| `@aws-sdk/client-secrets-manager` | ^3.998.0 | Fetch AIRS API key from Secrets Manager at bootstrap |

## Development

| Package | Version | Purpose |
|---|---|---|
| `vitest` | ^4.0.18 | Test framework (133 tests, 100% coverage enforced) |
| `@vitest/coverage-v8` | ^4.0.18 | V8-based code coverage provider |
| `@biomejs/biome` | ^2.4.4 | Linting + formatting (single tool, zero plugins) |
| `typescript` | ^5.7.0 | Type checking (strict mode) |
| `tsx` | ^4.0.0 | TypeScript execution for dev server |

## Why These Choices

**linkedom over jsdom** — The agent only needs text extraction and DOM traversal, not a full browser environment. linkedom is ~350x smaller and faster to install.

**Zod v4** — Used for both the incoming request schema (validated by BedrockAgentCoreApp) and the outgoing Recipe schema (validated after LLM extraction). Provides runtime type safety at system boundaries.

**Biome over ESLint + Prettier** — Single binary, zero config plugins, handles both linting and formatting. Faster than the ESLint + Prettier combination.
