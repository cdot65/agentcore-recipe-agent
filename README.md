# Recipe Extraction Agent

TypeScript agent on [Bedrock AgentCore](https://github.com/aws/bedrock-agentcore-sdk-typescript) that accepts a URL and returns a strongly-typed `Recipe` JSON object using Claude Haiku 4.5.

[![CI](https://github.com/cdot65/agentcore-recipe-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/cdot65/agentcore-recipe-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org/)

**[Documentation](https://cdot65.github.io/agentcore-recipe-agent/)**

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

```bash
curl -X POST http://localhost:8080/invocations \
  -H 'Content-Type: application/json' \
  -H 'x-amzn-bedrock-agentcore-runtime-session-id: test-session-1' \
  -d '{"url": "https://pinchofyum.com/chicken-wontons-in-spicy-chili-sauce"}'
```

## Key Features

- **URL to structured data** — fetches any recipe page, extracts JSON-LD + text, returns validated Recipe JSON
- **AI security scanning** — optional Prisma AIRS pre/post scanning for prompt injection and data leaks
- **CloudWatch observability** — structured JSON logs streamed from inside the container
- **100% test coverage** — 110 tests, enforced thresholds, pre-commit hooks
- **Automated CI/CD** — GitHub Actions with OIDC auth, ECR push, AgentCore runtime updates

## Documentation

Full docs at **[cdot65.github.io/agentcore-recipe-agent](https://cdot65.github.io/agentcore-recipe-agent/)**:

- [Getting Started](https://cdot65.github.io/agentcore-recipe-agent/getting-started/quick-start/) — prerequisites, setup, configuration
- [Architecture](https://cdot65.github.io/agentcore-recipe-agent/architecture/overview/) — system diagrams, request flow, design decisions
- [Deployment Guide](https://cdot65.github.io/agentcore-recipe-agent/deployment-guide/01-introduction-and-prerequisites/) — Docker, AWS infra, AgentCore, CI/CD
- [Reference](https://cdot65.github.io/agentcore-recipe-agent/reference/response-schema/) — response schema, env vars, dependencies
