# Part 6: AWS Infrastructure Setup

[<- Back to Index](./README.md) | [Previous: Docker Build](./05-docker-and-container-build.md) | [Next: Deploying to AgentCore ->](./07-deploying-to-agentcore.md)

---

## Resource Overview

Before deploying the agent, three AWS resources need to be created:

| Resource | Name | Purpose |
|---|---|---|
| **Secrets Manager secret** | `recipe-agent/prisma-airs-api-key` | Stores the Prisma AIRS API key |
| **IAM execution role** | `BedrockAgentCoreRecipeAgent` | Permissions for the running container |
| **ECR repository** | `recipe-extraction-agent` | Docker image registry |

The deploy script (`scripts/deploy.sh`) creates the IAM role and ECR repo automatically. The Secrets Manager secret is created separately with `scripts/setup-secrets.sh`.

## 1. Secrets Manager

The AIRS API key needs to be stored securely — not baked into the Docker image or passed as a plain environment variable.

### `scripts/setup-secrets.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-west-2}"
SECRET_NAME="recipe-agent/prisma-airs-api-key"

if [[ -z "${PRISMA_AIRS_API_KEY:-}" ]]; then
  echo "ERROR: PRISMA_AIRS_API_KEY env var required" >&2
  exit 1
fi

echo "==> Creating secret: ${SECRET_NAME}"

if aws secretsmanager describe-secret \
    --secret-id "${SECRET_NAME}" --region "${REGION}" &>/dev/null; then
  echo "    Secret already exists. Updating value..."
  aws secretsmanager put-secret-value \
    --secret-id "${SECRET_NAME}" \
    --secret-string "${PRISMA_AIRS_API_KEY}" \
    --region "${REGION}"
  echo "    Updated."
else
  aws secretsmanager create-secret \
    --name "${SECRET_NAME}" \
    --secret-string "${PRISMA_AIRS_API_KEY}" \
    --description "Prisma AIRS API key for recipe-extraction-agent" \
    --region "${REGION}"
  echo "    Created."
fi
```

**Usage:**

```bash
PRISMA_AIRS_API_KEY=your-key-here scripts/setup-secrets.sh
```

The script is idempotent — if the secret already exists, it updates the value.

At runtime, `src/main.ts` fetches this secret during bootstrap:

```typescript
const secret = await sm.send(
  new GetSecretValueCommand({ SecretId: "recipe-agent/prisma-airs-api-key" }),
);
```

> **Note:** If you're not using Prisma AIRS, you can skip this step entirely. The agent works without it.

## 2. IAM Execution Role

The AgentCore runtime assumes an IAM role to access AWS services. The deploy script creates `BedrockAgentCoreRecipeAgent` with four policies:

### Trust Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "bedrock-agentcore.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
```

This allows the AgentCore service to assume the role on behalf of your container.

### Policy 1: ECR Read (AWS Managed)

```
arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
```

Allows AgentCore to pull the Docker image from ECR.

### Policy 2: Bedrock Invoke Model

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream"
    ],
    "Resource": [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:*:ACCOUNT_ID:inference-profile/*"
    ]
  }]
}
```

Grants access to invoke Bedrock models. Two resource ARNs are needed:
- `foundation-model/*` — direct model access
- `inference-profile/*` — cross-region inference profiles (the `us.` prefix in the model ID)

### Policy 3: Secrets Manager Read

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["secretsmanager:GetSecretValue"],
    "Resource": "arn:aws:secretsmanager:us-west-2:ACCOUNT_ID:secret:recipe-agent/*"
  }]
}
```

Allows reading the AIRS API key secret. Scoped to the `recipe-agent/` prefix.

### Policy 4: CloudWatch Logs

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ],
    "Resource": "arn:aws:logs:us-west-2:ACCOUNT_ID:log-group:/aws/bedrock/agentcore/recipe-extraction-agent:*"
  }]
}
```

Allows the CloudWatch stream (from [Part 4](./04-observability-cloudwatch-logs.md)) to create log streams and write events.

### Creation in the deploy script

The IAM role section in `scripts/deploy.sh`:

```bash
ROLE_NAME="BedrockAgentCoreRecipeAgent"

TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "bedrock-agentcore.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}'

if ! aws iam get-role --role-name "${ROLE_NAME}" &>/dev/null; then
  aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document "${TRUST_POLICY}" \
    --description "Execution role for recipe-extraction-agent on AgentCore"

  aws iam attach-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

  aws iam put-role-policy --role-name "${ROLE_NAME}" \
    --policy-name BedrockInvokeModel --policy-document '...'

  aws iam put-role-policy --role-name "${ROLE_NAME}" \
    --policy-name SecretsManagerRead --policy-document '...'

  aws iam put-role-policy --role-name "${ROLE_NAME}" \
    --policy-name CloudWatchLogs --policy-document '...'

  echo "Created role. Waiting for propagation..."
  sleep 10
else
  echo "Role already exists."
fi
```

The `sleep 10` after creation gives IAM time to propagate globally — without it, the `create-agent-runtime` call may fail with "role not found."

## 3. ECR Repository

```bash
REPO="recipe-extraction-agent"

if ! aws ecr describe-repositories \
    --repository-names "${REPO}" --region "${REGION}" &>/dev/null; then
  aws ecr create-repository --repository-name "${REPO}" --region "${REGION}"
  echo "Created ECR repository."
else
  echo "ECR repository already exists."
fi
```

Idempotent — skips if the repo already exists.

## Environment Variable Reference

Complete list of environment variables used across the project:

| Variable | Where Set | Required | Description |
|---|---|---|---|
| `AWS_REGION` | `.env` / runtime env | No (defaults to `us-west-2`) | AWS region for all service calls |
| `AWS_ACCOUNT_ID` | `.env` / runtime env | No | Used for agent ARN in AIRS metadata |
| `PRISMA_AIRS_API_KEY` | Secrets Manager | No | AIRS API key (fetched at bootstrap) |
| `PRISMA_AIRS_PROFILE_NAME` | Runtime env var | No | AIRS security profile name |
| `PRISMA_AIRS_API_URL` | `.env` | No | Override AIRS API endpoint |
| `BEDROCK_AGENT_ID` | Runtime env var | No | AgentCore runtime ID (enables CloudWatch + AIRS metadata) |
| `BEDROCK_AGENT_VERSION` | Runtime env var | No | Agent version (defaults to "1") |
| `AGENTCORE_RUNTIME_ID` | `.env` / CI secret | For `--update` | Runtime ID for update deploys |

---

[Next: Deploying to AgentCore ->](./07-deploying-to-agentcore.md)
