# Part 5: Docker & Container Build

[<- Back to Index](./README.md) | [Previous: Observability](./04-observability-cloudwatch-logs.md) | [Next: AWS Infrastructure ->](./06-aws-infrastructure-setup.md)

---

## Why ARM64?

AgentCore runs containers on **AWS Graviton** processors (ARM64 architecture). If you build an x86/amd64 image and deploy it to AgentCore, it will fail to start. Every build must target `linux/arm64`.

## The Dockerfile

A multi-stage build that separates TypeScript compilation from the production image:

```dockerfile
# Dockerfile

# Build stage
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist/ ./dist/
EXPOSE 8080
CMD ["node", "dist/main.js"]
```

### Stage 1: Builder

| Line | Purpose |
|---|---|
| `FROM --platform=linux/arm64 ... AS builder` | ARM64 base image with Node 20 |
| `COPY package.json package-lock.json` | Copy dependency manifests first (layer caching) |
| `npm ci --ignore-scripts` | Install all deps (including devDependencies for `tsc`) |
| `COPY tsconfig.json ./` and `COPY src/ ./src/` | Copy source files |
| `npm run build` | Run `tsc` — compiles TypeScript to `dist/` |

### Stage 2: Production

| Line | Purpose |
|---|---|
| `FROM --platform=linux/arm64 ... node:20-slim` | Fresh slim image (no build artifacts) |
| `npm ci --omit=dev --ignore-scripts` | Install only production dependencies |
| `COPY --from=builder /app/dist/ ./dist/` | Copy compiled JS from builder stage |
| `EXPOSE 8080` | Document the port (AgentCore expects 8080) |
| `CMD ["node", "dist/main.js"]` | Start the agent |

**Why `--ignore-scripts`?** Prevents `prepare` and other lifecycle scripts from running during `npm ci`. Inside Docker, there's no git repo, so the `prepare` script (`git config core.hooksPath .githooks`) would fail.

**Why `node:20-slim`?** The `-slim` variant excludes build tools (gcc, make, python) that aren't needed at runtime. This keeps the image smaller.

**Why public ECR?** `public.ecr.aws/docker/library/node:20-slim` is the official Node image hosted on Amazon's public ECR registry. It avoids Docker Hub rate limits in CI environments.

## .dockerignore

```
node_modules
dist
tests
.git
.github
.githooks
.env
*.md
coverage
```

Keeps the Docker build context small and prevents sensitive files (`.env`) from being included in the image.

## Building Locally

### Standard build

```bash
docker build --platform linux/arm64 -t recipe-extraction-agent .
```

### Apple Silicon (M1/M2/M3/M4)

On Apple Silicon Macs, Docker runs ARM64 natively — the build will be fast:

```bash
docker build --platform linux/arm64 -t recipe-extraction-agent .
```

### Intel/AMD Macs and Linux

On x86 machines, Docker uses QEMU emulation for ARM64 builds. This is **significantly slower** (5-10x). The build works but expect longer compile times.

For CI, we use Docker Buildx with GitHub Actions (which supports ARM64 natively via QEMU) — see [Part 8](./08-ci-cd-with-github-actions.md).

## Running the Container Locally

```bash
docker run -p 8080:8080 --env-file .env recipe-extraction-agent
```

This maps port 8080 from the container to your host. The `--env-file .env` flag passes your local environment variables (AWS credentials, AIRS keys) into the container.

> **Note:** Your `.env` file needs valid AWS credentials for Bedrock access. If you're using AWS profiles or SSO, you may need to pass credentials differently:
>
> ```bash
> docker run -p 8080:8080 \
>   -e AWS_ACCESS_KEY_ID \
>   -e AWS_SECRET_ACCESS_KEY \
>   -e AWS_SESSION_TOKEN \
>   -e AWS_REGION=us-west-2 \
>   recipe-extraction-agent
> ```

### Test the container

```bash
# Health check
curl http://localhost:8080/ping

# Invoke
curl -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-amzn-bedrock-agentcore-runtime-session-id: test-session-1" \
  -d '{"url": "https://pinchofyum.com/chicken-wontons-in-spicy-chili-sauce"}'
```

## Image Size

The multi-stage build produces a lean production image:

- **Builder stage:** ~400MB (includes TypeScript, devDependencies)
- **Production image:** ~200MB (Node 20 slim + production deps + compiled JS)

The biggest contributors to image size are the AWS SDK packages (`@aws-sdk/client-*`). These are tree-shaken at the module level but still add significant weight.

---

[Next: AWS Infrastructure Setup ->](./06-aws-infrastructure-setup.md)
