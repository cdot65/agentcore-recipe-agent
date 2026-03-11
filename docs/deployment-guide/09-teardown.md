# Part 9: Teardown


To fully remove all AWS resources created by this project, run the following commands in order.

> **Note:** Replace placeholder values (`RUNTIME_ID`, `ACCOUNT_ID`) with your actual values. Set the region if different from `us-west-2`.

```bash
REGION="us-west-2"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

## 1. Delete AgentCore Runtime

```bash
aws bedrock-agentcore-control delete-agent-runtime \
  --agent-runtime-id "${AGENTCORE_RUNTIME_ID}" \
  --region "${REGION}"
```

## 2. Delete ECR Repository

This deletes the repository and all images inside it:

```bash
aws ecr delete-repository \
  --repository-name recipe-extraction-agent \
  --region "${REGION}" \
  --force
```

## 3. Delete IAM Execution Role

Detach policies first, then delete the role:

```bash
# Detach managed policy
aws iam detach-role-policy \
  --role-name BedrockAgentCoreRecipeAgent \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

# Delete inline policies
aws iam delete-role-policy \
  --role-name BedrockAgentCoreRecipeAgent \
  --policy-name BedrockInvokeModel

aws iam delete-role-policy \
  --role-name BedrockAgentCoreRecipeAgent \
  --policy-name SecretsManagerRead

aws iam delete-role-policy \
  --role-name BedrockAgentCoreRecipeAgent \
  --policy-name CloudWatchLogs

# Delete the role
aws iam delete-role --role-name BedrockAgentCoreRecipeAgent
```

## 4. Delete GitHub Actions IAM Role

```bash
# Delete inline policies
aws iam delete-role-policy \
  --role-name github-actions-recipe-agent \
  --policy-name ecr-push

aws iam delete-role-policy \
  --role-name github-actions-recipe-agent \
  --policy-name agentcore-deploy

# Delete the role
aws iam delete-role --role-name github-actions-recipe-agent
```

## 5. Delete Secrets Manager Secret

```bash
aws secretsmanager delete-secret \
  --secret-id recipe-agent/prisma-airs-api-key \
  --force-delete-without-recovery \
  --region "${REGION}"
```

The `--force-delete-without-recovery` flag deletes immediately without the default 7-day recovery window.

## 6. Delete CloudWatch Log Group

```bash
aws logs delete-log-group \
  --log-group-name /aws/bedrock/agentcore/recipe-extraction-agent \
  --region "${REGION}"
```

## 7. Remove GitHub Secrets

```bash
gh secret delete AWS_ROLE_ARN
gh secret delete AGENTCORE_RUNTIME_ID
gh secret delete AGENTCORE_ROLE_ARN
```

## Verification

Confirm all resources are removed:

```bash
# Should all return errors or empty results
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id "${AGENTCORE_RUNTIME_ID}" --region "${REGION}" 2>&1 || true

aws ecr describe-repositories \
  --repository-names recipe-extraction-agent --region "${REGION}" 2>&1 || true

aws iam get-role --role-name BedrockAgentCoreRecipeAgent 2>&1 || true

aws iam get-role --role-name github-actions-recipe-agent 2>&1 || true

aws secretsmanager describe-secret \
  --secret-id recipe-agent/prisma-airs-api-key --region "${REGION}" 2>&1 || true

aws logs describe-log-groups \
  --log-group-name-prefix /aws/bedrock/agentcore/recipe-extraction-agent \
  --region "${REGION}"
```

