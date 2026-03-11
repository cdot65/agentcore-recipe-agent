#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Create IAM role for GitHub Actions OIDC → ECR push + AgentCore deploy
#
# Prerequisites:
#   - GitHub OIDC provider already exists in the account
#   - ECR repository "recipe-extraction-agent" already exists
#
# Usage:
#   AGENTCORE_RUNTIME_ID=<runtime-id> scripts/setup-github-iam.sh
#
# Required env vars:
#   AGENTCORE_RUNTIME_ID    AgentCore runtime ID from first deploy
###############################################################################

REGION="${AWS_REGION:-us-west-2}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ROLE_NAME="github-actions-recipe-agent"
REPO="cdot65/agentcore-recipe-agent"
ECR_REPO="recipe-extraction-agent"

if [[ -z "${AGENTCORE_RUNTIME_ID:-}" ]]; then
  echo "ERROR: AGENTCORE_RUNTIME_ID env var required" >&2
  exit 1
fi
RUNTIME_ID="${AGENTCORE_RUNTIME_ID}"

echo "==> Creating GitHub Actions role: ${ROLE_NAME}"

TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:${REPO}:*"
      }
    }
  }]
}
EOF
)

if ! aws iam get-role --role-name "${ROLE_NAME}" &>/dev/null; then
  aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document "${TRUST_POLICY}" \
    --description "GitHub Actions role for recipe-extraction-agent CI/CD"
  echo "    Created role."
else
  echo "    Role already exists. Updating trust policy..."
  aws iam update-assume-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-document "${TRUST_POLICY}"
fi

# ECR push policy
echo "==> Attaching ECR push policy"
aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name ecr-push \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Effect\": \"Allow\",
        \"Action\": \"ecr:GetAuthorizationToken\",
        \"Resource\": \"*\"
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [
          \"ecr:BatchCheckLayerAvailability\",
          \"ecr:GetDownloadUrlForLayer\",
          \"ecr:BatchGetImage\",
          \"ecr:PutImage\",
          \"ecr:InitiateLayerUpload\",
          \"ecr:UploadLayerPart\",
          \"ecr:CompleteLayerUpload\"
        ],
        \"Resource\": \"arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${ECR_REPO}\"
      }
    ]
  }"

# AgentCore deploy policy
echo "==> Attaching AgentCore deploy policy"
aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name agentcore-deploy \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Effect\": \"Allow\",
        \"Action\": [
          \"bedrock-agentcore:UpdateAgentRuntime\",
          \"bedrock-agentcore:GetAgentRuntime\"
        ],
        \"Resource\": \"arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/${RUNTIME_ID}\"
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": \"iam:PassRole\",
        \"Resource\": \"arn:aws:iam::${ACCOUNT_ID}:role/BedrockAgentCoreRecipeAgent\",
        \"Condition\": {
          \"StringEquals\": {
            \"iam:PassedToService\": \"bedrock-agentcore.amazonaws.com\"
          }
        }
      }
    ]
  }"

ROLE_ARN=$(aws iam get-role --role-name "${ROLE_NAME}" --query 'Role.Arn' --output text)

echo ""
echo "==> Done! Role ARN: ${ROLE_ARN}"
echo ""
echo "Set GitHub repo secrets:"
echo "  gh secret set AWS_ROLE_ARN -b \"${ROLE_ARN}\""
echo "  gh secret set AGENTCORE_RUNTIME_ID -b \"${RUNTIME_ID}\""
echo "  gh secret set AGENTCORE_ROLE_ARN -b \"$(aws iam get-role --role-name BedrockAgentCoreRecipeAgent --query 'Role.Arn' --output text)\""
