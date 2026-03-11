# Recipe Extraction Agent

TypeScript agent built on [Bedrock AgentCore](https://github.com/aws/bedrock-agentcore-sdk-typescript) + [Strands Agents SDK](https://github.com/strands-agents/sdk-typescript) that accepts a URL, fetches the webpage, and uses an LLM to extract a strongly-typed `Recipe` object.

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design and request flow diagrams.
See [docs/deployment-guide/](docs/deployment-guide/README.md) for the full 9-part deployment guide.

## Quick Start

```bash
npm install
cp .env.example .env   # fill in your values
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
    { "quantity": 8, "unit": "ounces", "name": "shiitake mushrooms", "description": "sliced" }
  ],
  "preparationSteps": ["Slice shiitake mushrooms", "Grate garlic clove"],
  "cookingSteps": ["Heat 1 tablespoon sesame oil in a large nonstick skillet..."],
  "notes": {
    "servings": "4 servings",
    "cookTime": "10 minutes",
    "prepTime": "5 minutes",
    "tips": ["Use mini chicken cilantro wontons from Trader Joe's"]
  }
}
```

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with tsx (hot reload) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output |
| `npm test` | Run test suite (110 tests, Vitest) |
| `npm run test:coverage` | Tests with coverage (100% enforced) |
| `npm run typecheck` | Type-check without emitting (`tsc --noEmit`) |
| `npm run check` | Lint + format (Biome) |
| `npm run check:fix` | Auto-fix lint + format issues |

## Project Structure

```
src/
  app.ts                 Agent logic, extractJson, processHandler, AIRS scanning
  main.ts                Bootstrap (Secrets Manager fetch) → import app → app.run()
  lib/
    cloudwatch-stream.ts Custom CloudWatch log stream
  schemas/
    recipe.ts            Zod schemas for Recipe and Ingredient
  tools/
    fetch-url.ts         Custom tool: fetch URL, strip HTML, extract JSON-LD
tests/
  unit/                  Schema, extractJson, fetch-url, cloudwatch-stream tests
  integration/           processHandler tests (mocked Agent + BedrockAgentCoreApp)
scripts/
  deploy.sh              First deploy + update AgentCore runtime
  setup-github-iam.sh    Create IAM role for GitHub Actions OIDC
  setup-secrets.sh       Store AIRS API key in Secrets Manager
docs/
  deployment-guide/      9-part deployment guide (Parts 01–09)
.githooks/
  pre-commit             Runs typecheck → lint → test
.github/
  workflows/
    ci.yml               CI on PR/push to main (typecheck, lint, test)
    deploy.yml           Build → ECR push → AgentCore update on push to main
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AWS_REGION` | No | Defaults to `us-west-2` |
| `PANW_AI_SEC_API_KEY` | No | Prisma AIRS API key (enables security scanning) |
| `PRISMA_AIRS_PROFILE_NAME` | No | AIRS profile name (required with API key) |
| `BEDROCK_AGENT_ID` | No | Enables CloudWatch log streaming when set |

See `.env.example` for the full list. If AIRS is not configured, the agent operates normally (fail-open).

## Security — Prisma AIRS

The agent integrates [Prisma AIRS](https://docs.paloaltonetworks.com/prisma/prisma-cloud/prisma-cloud-admin/prisma-airs) for AI-layer threat detection:

1. **Pre-scan** — inbound prompt scanned for injection, malicious URLs, toxic content
2. **Post-scan** — outbound recipe JSON scanned for DLP violations, malicious content

When a scan blocks a request:

```json
{
  "error": "blocked",
  "message": "Request blocked by Prisma AIRS security.",
  "category": "Prompt-Injection",
  "scan_id": "scan-abc123"
}
```

## Dependencies

| Package | Purpose |
|---|---|
| `bedrock-agentcore` | Runtime server (Fastify on :8080) |
| `@strands-agents/sdk` | Agent framework (Agent, BedrockModel, tool) |
| `@cdot65/prisma-airs-sdk` | Prisma AIRS AI Runtime Security scanning |
| `zod` v4 | Request/response schema validation |
| `linkedom` | Lightweight HTML parsing (~200KB vs jsdom's 70MB) |
| `vitest` | Test framework (110 tests, 100% coverage) |
| `@biomejs/biome` | Linting + formatting |
