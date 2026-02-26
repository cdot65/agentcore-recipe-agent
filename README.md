# Recipe Extraction Agent

TypeScript agent built on [Bedrock AgentCore](https://github.com/aws/bedrock-agentcore-sdk-typescript) + [Strands Agents SDK](https://github.com/strands-agents/sdk-typescript) that accepts a URL, fetches the webpage, and uses an LLM to extract a strongly-typed `Recipe` object.

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design and request flow diagrams.

## Prerequisites

- Node.js 20+
- AWS credentials configured with Bedrock access (`us.anthropic.claude-haiku-4-5-20251001-v1:0` in `us-west-2`)

## Setup

```bash
npm install
```

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with tsx (hot reload) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output |
| `npm test` | Run test suite (71 tests, Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage (100% enforced) |
| `npm run typecheck` | Type-check without emitting (`tsc --noEmit`) |
| `npm run lint` | Lint with Biome |
| `npm run format` | Check formatting with Biome |
| `npm run check` | Lint + format combined |
| `npm run check:fix` | Auto-fix lint + format issues |
| `npm run test:local` | Start server, hit /ping, POST a recipe URL, print result |

## Usage

Start the server:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:8080/ping
```

Extract a recipe:

```bash
curl -X POST http://localhost:8080/invocations \
  -H 'Content-Type: application/json' \
  -H 'x-amzn-bedrock-agentcore-runtime-session-id: test-session-1' \
  -d '{"url": "https://pinchofyum.com/chicken-wontons-in-spicy-chili-sauce"}'
```

## Response Shape

```json
{
  "title": "Chicken Wontons in Spicy Chili Sauce",
  "ingredients": [
    { "quantity": 3, "unit": "tablespoons", "name": "sesame oil", "description": "divided" },
    { "quantity": 8, "unit": "ounces", "name": "shiitake mushrooms", "description": "sliced" },
    { "quantity": 12, "unit": "ounces", "name": "frozen chicken wontons", "description": "" }
  ],
  "preparationSteps": [
    "Slice shiitake mushrooms",
    "Grate garlic clove"
  ],
  "cookingSteps": [
    "Heat 1 tablespoon sesame oil in a large nonstick skillet over medium heat...",
    "Add the frozen wontons, chicken broth, and teriyaki sauce. Simmer for 5 minutes..."
  ],
  "notes": {
    "servings": "4 servings",
    "cookTime": "10 minutes",
    "prepTime": "5 minutes",
    "tips": ["Use mini chicken cilantro wontons from Trader Joe's or Costco for best results"]
  }
}
```

## Prisma AIRS AI Runtime Security

The agent integrates [Prisma AIRS](https://docs.paloaltonetworks.com/prisma/prisma-cloud/prisma-cloud-admin/prisma-airs) for AI-layer threat detection. Every request passes through two security checkpoints:

1. **Pre-scan** — inbound prompt scanned for injection, malicious URLs, toxic content
2. **Post-scan** — outbound recipe JSON scanned for DLP violations, malicious content

Configure via `.env` (see `.env.example`):

```bash
PRISMA_AIRS_API_KEY=your-api-key
PRISMA_AIRS_PROFILE_NAME=your-profile-name

# Optional: agent metadata for AIRS agent discovery
BEDROCK_AGENT_ID=
BEDROCK_AGENT_VERSION=1
AWS_ACCOUNT_ID=
AWS_REGION=us-west-2
```

If AIRS is not configured, the agent operates normally (fail-open).

When a scan blocks a request, the response includes:

```json
{
  "error": "blocked",
  "message": "Request blocked by Prisma AIRS security.",
  "category": "Prompt-Injection",
  "scan_id": "scan-abc123"
}
```

## Project Structure

```
src/
  app.ts                 Agent logic, extractJson, processHandler (exports)
  main.ts                Entry point (imports app, calls app.run())
  lib/
    airs-api-client.ts   Prisma AIRS API client (prompt + response scanning)
  schemas/
    recipe.ts            Zod schemas for Recipe and Ingredient
  tools/
    fetch-url.ts         Custom tool: fetch URL, strip HTML, extract JSON-LD
tests/
  unit/
    schemas/
      recipe.test.ts     Schema validation tests
    tools/
      fetch-url.test.ts  URL fetch + HTML parsing tests
    extract-json.test.ts JSON extraction tier tests
  integration/
    process-handler.test.ts  End-to-end handler tests
.githooks/
  pre-commit             Runs typecheck → lint → test before each commit
.github/
  workflows/
    ci.yml               GitHub Actions CI (typecheck, lint, test on PR/push to main)
```

## Key Dependencies

| Package | Purpose |
|---|---|
| `bedrock-agentcore` | Runtime server (Fastify on :8080) |
| `@strands-agents/sdk` | Agent framework (Agent, BedrockModel, tool) |
| `zod` v4 | Request/response schema validation |
| `linkedom` | Lightweight HTML parsing (~200KB vs jsdom's 70MB) |

## Dev Dependencies

| Package | Purpose |
|---|---|
| `vitest` | Test framework (71 tests, 100% coverage) |
| `@vitest/coverage-v8` | V8-based code coverage |
| `@biomejs/biome` | Linting + formatting |
| `typescript` | Type checking |
| `tsx` | TypeScript execution for dev server |
