#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Deploy recipe-extraction-agent to AWS Bedrock AgentCore
#
# Usage:
#   scripts/deploy.sh              # first deploy (creates runtime)
#   scripts/deploy.sh --update     # subsequent deploys (updates runtime)
#
# Required env vars for --update:
#   AGENTCORE_RUNTIME_ID           # from first deploy output
#
# Optional env vars passed to runtime:
#   PRISMA_AIRS_PROFILE_NAME    (PANW_AI_SEC_API_KEY is in Secrets Manager)
###############################################################################

REGION="${AWS_REGION:-us-west-2}"
REPO="recipe-extraction-agent"
ROLE_NAME="BedrockAgentCoreRecipeAgent"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO}"
UPDATE=false

if [[ "${1:-}" == "--update" ]]; then
  UPDATE=true
fi

###############################################################################
# 1. IAM Role (idempotent)
###############################################################################
echo "==> Ensuring IAM role: ${ROLE_NAME}"

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

  aws iam put-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-name BedrockInvokeModel \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{
        \"Effect\": \"Allow\",
        \"Action\": [
          \"bedrock:InvokeModel\",
          \"bedrock:InvokeModelWithResponseStream\"
        ],
        \"Resource\": [
          \"arn:aws:bedrock:*::foundation-model/*\",
          \"arn:aws:bedrock:*:${ACCOUNT_ID}:inference-profile/*\"
        ]
      }]
    }"

  aws iam put-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-name SecretsManagerRead \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{
        \"Effect\": \"Allow\",
        \"Action\": [\"secretsmanager:GetSecretValue\"],
        \"Resource\": \"arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:recipe-agent/*\"
      }]
    }"

  aws iam put-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-name CloudWatchLogs \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{
        \"Effect\": \"Allow\",
        \"Action\": [\"logs:CreateLogGroup\", \"logs:CreateLogStream\", \"logs:PutLogEvents\"],
        \"Resource\": \"arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/bedrock/agentcore/recipe-extraction-agent:*\"
      }]
    }"

  echo "    Created role and attached policies. Waiting for propagation..."
  sleep 10
else
  echo "    Role already exists."
  # Ensure policies are attached (idempotent)
  aws iam put-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-name SecretsManagerRead \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{
        \"Effect\": \"Allow\",
        \"Action\": [\"secretsmanager:GetSecretValue\"],
        \"Resource\": \"arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:recipe-agent/*\"
      }]
    }"
  aws iam put-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-name CloudWatchLogs \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{
        \"Effect\": \"Allow\",
        \"Action\": [\"logs:CreateLogGroup\", \"logs:CreateLogStream\", \"logs:PutLogEvents\"],
        \"Resource\": \"arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/bedrock/agentcore/recipe-extraction-agent:*\"
      }]
    }"
fi

ROLE_ARN=$(aws iam get-role --role-name "${ROLE_NAME}" --query 'Role.Arn' --output text)

###############################################################################
# 2. ECR Repository (idempotent)
###############################################################################
echo "==> Ensuring ECR repository: ${REPO}"

if ! aws ecr describe-repositories --repository-names "${REPO}" --region "${REGION}" &>/dev/null; then
  aws ecr create-repository --repository-name "${REPO}" --region "${REGION}"
  echo "    Created ECR repository."
else
  echo "    ECR repository already exists."
fi

###############################################################################
# 3. Build & Push
###############################################################################
echo "==> Building TypeScript"
npm run build

echo "==> Building Docker image (linux/arm64)"
docker build --platform linux/arm64 -t "${REPO}" .

echo "==> Pushing to ECR"
docker tag "${REPO}:latest" "${ECR_URI}:latest"
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker push "${ECR_URI}:latest"

###############################################################################
# 4. Create or Update AgentCore Runtime
###############################################################################
ENV_VARS="{\"AWS_REGION\":\"${REGION}\",\"AWS_ACCOUNT_ID\":\"${ACCOUNT_ID}\""
[[ -n "${PRISMA_AIRS_PROFILE_NAME:-}" ]] && ENV_VARS+=",\"PRISMA_AIRS_PROFILE_NAME\":\"${PRISMA_AIRS_PROFILE_NAME}\""
ENV_VARS+="}"

ARTIFACT="{\"containerConfiguration\":{\"containerUri\":\"${ECR_URI}:latest\"}}"

if [[ "${UPDATE}" == true ]]; then
  if [[ -z "${AGENTCORE_RUNTIME_ID:-}" ]]; then
    echo "ERROR: --update requires AGENTCORE_RUNTIME_ID env var" >&2
    exit 1
  fi

  # Include BEDROCK_AGENT_ID on updates (we know the runtime ID)
  UPDATE_ENV_VARS="${ENV_VARS%\}},\"BEDROCK_AGENT_ID\":\"${AGENTCORE_RUNTIME_ID}\"}"

  echo "==> Updating AgentCore runtime: ${AGENTCORE_RUNTIME_ID}"
  aws bedrock-agentcore-control update-agent-runtime \
    --agent-runtime-id "${AGENTCORE_RUNTIME_ID}" \
    --agent-runtime-artifact "${ARTIFACT}" \
    --role-arn "${ROLE_ARN}" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --protocol-configuration '{"serverProtocol":"HTTP"}' \
    --environment-variables "${UPDATE_ENV_VARS}" \
    --region "${REGION}"
else
  echo "==> Creating AgentCore runtime"
  CREATE_OUTPUT=$(aws bedrock-agentcore-control create-agent-runtime \
    --agent-runtime-name recipe_extraction_agent \
    --agent-runtime-artifact "${ARTIFACT}" \
    --role-arn "${ROLE_ARN}" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --protocol-configuration '{"serverProtocol":"HTTP"}' \
    --environment-variables "${ENV_VARS}" \
    --region "${REGION}")

  RUNTIME_ID=$(echo "${CREATE_OUTPUT}" | python3 -c "import sys,json; print(json.load(sys.stdin)['agentRuntimeId'])")
  echo ""
  echo "    Runtime ID: ${RUNTIME_ID}"
  echo "    Save this as AGENTCORE_RUNTIME_ID and BEDROCK_AGENT_ID for future deploys."
  echo ""
  echo "    NOTE: BEDROCK_AGENT_ID was not set for this initial deploy."
  echo "    Run 'scripts/deploy.sh --update' to inject it into the runtime env."
fi

###############################################################################
# 5. Wait for READY
###############################################################################
RUNTIME_ID="${AGENTCORE_RUNTIME_ID:-${RUNTIME_ID:-}}"

if [[ -n "${RUNTIME_ID}" ]]; then
  echo "==> Waiting for runtime to become READY..."
  for i in $(seq 1 30); do
    STATUS=$(aws bedrock-agentcore-control get-agent-runtime \
      --agent-runtime-id "${RUNTIME_ID}" \
      --region "${REGION}" \
      --query 'status' --output text 2>/dev/null || echo "UNKNOWN")

    echo "    Status: ${STATUS} (attempt ${i}/30)"

    if [[ "${STATUS}" == "READY" ]]; then
      echo "==> Runtime is READY!"
      exit 0
    elif [[ "${STATUS}" == "FAILED" ]]; then
      echo "ERROR: Runtime entered FAILED state" >&2
      aws bedrock-agentcore-control get-agent-runtime \
        --agent-runtime-id "${RUNTIME_ID}" \
        --region "${REGION}"
      exit 1
    fi

    sleep 10
  done

  echo "WARNING: Runtime did not reach READY within 5 minutes. Check manually:"
  echo "  aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id ${RUNTIME_ID} --region ${REGION}"
fi
