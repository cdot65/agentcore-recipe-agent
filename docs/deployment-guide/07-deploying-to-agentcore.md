# Part 7: Deploying to AgentCore

[<- Back to Index](./README.md) | [Previous: Infrastructure](./06-aws-infrastructure-setup.md) | [Next: CI/CD ->](./08-ci-cd-with-github-actions.md)

---

## Deploy Script Overview

`scripts/deploy.sh` handles the full deployment lifecycle:

```
scripts/deploy.sh            # First deploy: IAM + ECR + build + push + create runtime
scripts/deploy.sh --update   # Subsequent: build + push + update runtime
```

The script is idempotent for infrastructure (IAM, ECR) and linear for the deploy itself.

## First Deploy

Run the deploy script with no arguments:

```bash
scripts/deploy.sh
```

This executes five steps:

### Step 1: IAM Role

Creates `BedrockAgentCoreRecipeAgent` with all required policies (covered in [Part 6](./06-aws-infrastructure-setup.md)).

### Step 2: ECR Repository

Creates the `recipe-extraction-agent` ECR repository.

### Step 3: Build & Push

```bash
# Compile TypeScript
npm run build

# Build ARM64 Docker image
docker build --platform linux/arm64 -t recipe-extraction-agent .

# Tag and push to ECR
docker tag recipe-extraction-agent:latest \
  ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/recipe-extraction-agent:latest

aws ecr get-login-password --region ${REGION} | \
  docker login --username AWS --password-stdin \
  ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

docker push ${ECR_URI}:latest
```

### Step 4: Create AgentCore Runtime

```bash
aws bedrock-agentcore-control create-agent-runtime \
  --agent-runtime-name recipe_extraction_agent \
  --agent-runtime-artifact '{"containerConfiguration":{"containerUri":"ECR_URI:latest"}}' \
  --role-arn "${ROLE_ARN}" \
  --network-configuration '{"networkMode":"PUBLIC"}' \
  --protocol-configuration '{"serverProtocol":"HTTP"}' \
  --environment-variables '{"AWS_REGION":"us-west-2","AWS_ACCOUNT_ID":"..."}' \
  --region us-west-2
```

**Key parameters:**

| Parameter | Value | Purpose |
|---|---|---|
| `--agent-runtime-name` | `recipe_extraction_agent` | Display name in the console |
| `--agent-runtime-artifact` | Container URI in ECR | Points to your Docker image |
| `--role-arn` | IAM execution role ARN | Permissions for the container |
| `--network-configuration` | `PUBLIC` | Container has internet access (needed for recipe URLs) |
| `--protocol-configuration` | `HTTP` | Fastify HTTP server (not WebSocket) |
| `--environment-variables` | JSON object | Env vars injected into the container |

The command returns the **runtime ID**:

```
Runtime ID: abc123-def456-...
Save this as AGENTCORE_RUNTIME_ID and BEDROCK_AGENT_ID for future deploys.
```

> **Important:** The first deploy does **not** set `BEDROCK_AGENT_ID` in the container's environment (because we don't know the runtime ID until after creation). Run `--update` immediately after to inject it.

### Step 5: Poll for READY

```bash
for i in $(seq 1 30); do
  STATUS=$(aws bedrock-agentcore-control get-agent-runtime \
    --agent-runtime-id "${RUNTIME_ID}" \
    --region us-west-2 \
    --query 'status' --output text)

  echo "Status: ${STATUS} (attempt ${i}/30)"

  if [[ "${STATUS}" == "READY" ]]; then
    echo "Runtime is READY!"
    exit 0
  elif [[ "${STATUS}" == "FAILED" ]]; then
    echo "Runtime FAILED" >&2
    exit 1
  fi

  sleep 10
done
```

The script polls every 10 seconds for up to 5 minutes. AgentCore typically takes 1-3 minutes to pull the image and start the container.

## Save the Runtime ID

After the first deploy, save the runtime ID in your `.env`:

```bash
# .env
AGENTCORE_RUNTIME_ID=abc123-def456-...
```

Then immediately run an update to inject `BEDROCK_AGENT_ID`:

```bash
scripts/deploy.sh --update
```

## Subsequent Deploys

With `AGENTCORE_RUNTIME_ID` set:

```bash
scripts/deploy.sh --update
```

This skips IAM/ECR creation and goes straight to:
1. Build TypeScript
2. Build Docker image
3. Push to ECR
4. Update the runtime

The update command:

```bash
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id "${AGENTCORE_RUNTIME_ID}" \
  --agent-runtime-artifact '{"containerConfiguration":{"containerUri":"ECR_URI:latest"}}' \
  --role-arn "${ROLE_ARN}" \
  --network-configuration '{"networkMode":"PUBLIC"}' \
  --protocol-configuration '{"serverProtocol":"HTTP"}' \
  --environment-variables '{"AWS_REGION":"...","BEDROCK_AGENT_ID":"...","PRISMA_AIRS_PROFILE_NAME":"..."}' \
  --region us-west-2
```

On updates, the environment variables include `BEDROCK_AGENT_ID` (set to the runtime ID), which enables:
- CloudWatch log shipping (see [Part 4](./04-observability-cloudwatch-logs.md))
- Agent metadata in AIRS scans (see [Part 3](./03-security-with-prisma-airs.md))

## Testing the Deployment

Once the runtime is READY, invoke it via the AWS CLI:

```bash
aws bedrock-agentcore invoke-agent-runtime \
  --agent-runtime-id "${AGENTCORE_RUNTIME_ID}" \
  --payload '{"url": "https://pinchofyum.com/chicken-wontons-in-spicy-chili-sauce"}' \
  --region us-west-2 \
  output.json

cat output.json | jq .
```

Expected response:

```json
{
  "title": "Chicken Wontons in Spicy Chili Sauce",
  "ingredients": [...],
  "preparationSteps": [...],
  "cookingSteps": [...],
  "notes": {
    "servings": "4 servings",
    "cookTime": "10 minutes",
    "prepTime": "30 minutes"
  }
}
```

## Troubleshooting

### Runtime stuck in CREATING

AgentCore pulls the image from ECR and starts the container. This typically takes 1-3 minutes. If it's been more than 5 minutes:

```bash
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id "${AGENTCORE_RUNTIME_ID}" \
  --region us-west-2
```

Check the `status` and `statusReasons` fields.

### Runtime enters FAILED

Common causes:

| Issue | Fix |
|---|---|
| **Wrong architecture** | Ensure `--platform linux/arm64` in your Docker build |
| **Missing IAM permissions** | Check the execution role has all four policies |
| **Container crash** | Test locally first: `docker run -p 8080:8080 --env-file .env recipe-extraction-agent` |
| **Port mismatch** | The container must listen on port 8080 |
| **Health check timeout** | `/ping` must respond within 30 seconds of container start |

### Inference profile ARNs

If you see "access denied" errors when invoking Bedrock models, check that the IAM role includes `inference-profile/*` in its resource ARNs:

```json
"Resource": [
  "arn:aws:bedrock:*::foundation-model/*",
  "arn:aws:bedrock:*:ACCOUNT_ID:inference-profile/*"
]
```

The `us.` prefix in `us.anthropic.claude-haiku-4-5-20251001-v1:0` uses cross-region inference profiles, which require the second ARN pattern.

### Debugging with logs

If the container starts but invocations fail, check CloudWatch:

```bash
aws logs tail "/aws/bedrock/agentcore/recipe-extraction-agent" \
  --region us-west-2 --follow
```

---

[Next: CI/CD with GitHub Actions ->](./08-ci-cd-with-github-actions.md)
