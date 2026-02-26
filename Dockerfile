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
