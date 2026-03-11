# Quick Start

## 1. Install

```bash
git clone https://github.com/cdot65/agentcore-recipe-agent.git
cd agentcore-recipe-agent
npm install
```

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env` — at minimum set `AWS_REGION` (defaults to `us-west-2`). AIRS variables are optional.

## 3. Run

```bash
npm run dev
```

## 4. Test

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

The agent fetches the page, passes it to Claude Haiku 4.5, and returns a structured `Recipe` JSON object.

!!! info "Alternative request format"
    You can also send a natural language prompt containing a URL:

    ```bash
    curl -X POST http://localhost:8080/invocations \
      -H 'Content-Type: application/json' \
      -H 'x-amzn-bedrock-agentcore-runtime-session-id: test-session-1' \
      -d '{"prompt": "Extract the recipe from https://pinchofyum.com/chicken-wontons-in-spicy-chili-sauce"}'
    ```

## 5. Run Tests

```bash
npm test                   # 110 tests
npm run test:coverage      # with 100% coverage enforcement
npm run typecheck          # tsc --noEmit
npm run check              # biome lint + format
```
