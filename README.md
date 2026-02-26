# Recipe Extraction Agent

TypeScript agent built on [Bedrock AgentCore](https://github.com/aws/bedrock-agentcore-sdk-typescript) + [Strands Agents SDK](https://github.com/strands-agents/sdk-typescript) that accepts a URL, fetches the webpage, and uses an LLM to extract a strongly-typed `Recipe` object.

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design and request flow diagrams.

## Prerequisites

- Node.js 20+
- AWS credentials configured with Bedrock access (`us.anthropic.claude-haiku-4-5-20251001-v1:0` in `us-east-1`)

## Setup

```bash
pnpm install
```

## Scripts

| Script | Description |
|---|---|
| `pnpm run dev` | Start dev server with tsx (hot reload) |
| `pnpm run build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled output |
| `pnpm run test:local` | Start server, hit /ping, POST a recipe URL, print result |

## Usage

Start the server:

```bash
pnpm run dev
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

## Project Structure

```
src/
  agent.ts                 Entry point: Agent + BedrockAgentCoreApp
  schemas/
    recipe.ts              Zod schemas for Recipe and Ingredient
  tools/
    fetch-url.ts           Custom tool: fetch URL, strip HTML, extract JSON-LD
```

## Key Dependencies

| Package | Purpose |
|---|---|
| `bedrock-agentcore` | Runtime server (Fastify on :8080) |
| `@strands-agents/sdk` | Agent framework (Agent, BedrockModel, tool) |
| `zod` v4 | Request/response schema validation |
| `linkedom` | Lightweight HTML parsing (~200KB vs jsdom's 70MB) |
