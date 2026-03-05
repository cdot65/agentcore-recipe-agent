# Troubleshooting: Agent Runtime App Logging

This guide walks through verifying the **agent runtime app logging pipeline** — from the AgentCore container through to CloudWatch Logs. This is NOT about Bedrock model invocation logs (those are configured separately via `aws bedrock get-model-invocation-logging-configuration`).

> **Key concept:** AgentCore does NOT automatically capture container stdout to CloudWatch. This project uses a custom `createCloudWatchStream` that writes logs directly to CloudWatch via the AWS SDK from inside the container.

---

## Step 1: Verify the Agent Runtime Configuration

Get the runtime config and note the **role ARN**, **runtime ID**, and **environment variables**.

```bash
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id <RUNTIME_ID> \
  --region us-west-2
```

**Expected output (key fields):**

```json
{
  "agentRuntimeId": "recipe_extraction_agent-wkubdE7YBy",
  "status": "READY",
  "roleArn": "arn:aws:iam::<ACCOUNT_ID>:role/BedrockAgentCoreRecipeAgent",
  "environmentVariables": {
    "AWS_REGION": "us-west-2",
    "AWS_ACCOUNT_ID": "<ACCOUNT_ID>",
    "BEDROCK_AGENT_ID": "recipe_extraction_agent-wkubdE7YBy"
  }
}
```

**What to check:**

- `status` must be `READY`
- `BEDROCK_AGENT_ID` must be set — without it, the app skips CloudWatch streaming and only logs to stdout (which is lost)
- `AWS_REGION` must be set — the CloudWatch SDK uses this to determine which region to write logs to

---

## Step 2: Verify the CloudWatch Log Group Exists

The log group name is hardcoded in the app as `/aws/bedrock/agentcore/recipe-extraction-agent`. Confirm it exists.

```bash
aws logs describe-log-groups \
  --log-group-name-prefix /aws/bedrock/agentcore/recipe-extraction-agent \
  --region us-west-2
```

**Expected output:**

```json
{
  "logGroups": [
    {
      "logGroupName": "/aws/bedrock/agentcore/recipe-extraction-agent",
      "retentionInDays": 30,
      "storedBytes": 364615
    }
  ]
}
```

**If the log group does not exist**, create it:

```bash
aws logs create-log-group \
  --log-group-name /aws/bedrock/agentcore/recipe-extraction-agent \
  --region us-west-2

aws logs put-retention-policy \
  --log-group-name /aws/bedrock/agentcore/recipe-extraction-agent \
  --retention-in-days 30 \
  --region us-west-2
```

> **Common mistake:** Using the agent runtime ID or ARN as the log group name (e.g., `/aws/bedrock/agentcore/recipe_extraction_agent-wkubdE7YBy/DEFAULT`). The correct name uses hyphens and no runtime ID: `/aws/bedrock/agentcore/recipe-extraction-agent`.

---

## Step 3: Verify IAM Permissions

The agent's execution role needs `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents` on the correct log group.

### 3a. Get the role name from the runtime config

```bash
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id <RUNTIME_ID> \
  --region us-west-2 \
  --query 'roleArn' --output text
```

### 3b. Check the CloudWatch Logs inline policy

```bash
aws iam get-role-policy \
  --role-name BedrockAgentCoreRecipeAgent \
  --policy-name CloudWatchLogs
```

**Expected output:**

```json
{
  "PolicyDocument": {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        "Resource": "arn:aws:logs:us-west-2:<ACCOUNT_ID>:log-group:/aws/bedrock/agentcore/recipe-extraction-agent:*"
      }
    ]
  }
}
```

**What to check:**

- The `Resource` ARN must match the log group name **exactly** — including forward slashes vs hyphens
- All three actions must be present (`CreateLogGroup`, `CreateLogStream`, `PutLogEvents`)
- The region in the ARN must match where you're deploying

**If the policy is missing**, create it:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws iam put-role-policy \
  --role-name BedrockAgentCoreRecipeAgent \
  --policy-name CloudWatchLogs \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [
        \"logs:CreateLogGroup\",
        \"logs:CreateLogStream\",
        \"logs:PutLogEvents\"
      ],
      \"Resource\": \"arn:aws:logs:us-west-2:${ACCOUNT_ID}:log-group:/aws/bedrock/agentcore/recipe-extraction-agent:*\"
    }]
  }"
```

### 3c. Verify the trust policy allows AgentCore to assume the role

```bash
aws iam get-role \
  --role-name BedrockAgentCoreRecipeAgent \
  --query 'Role.AssumeRolePolicyDocument'
```

**Expected output:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "bedrock-agentcore.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

---

## Step 4: Check for Log Streams

After a deployment or invocation, the app creates log streams named `{hostname}-{ISO-timestamp}`.

```bash
aws logs describe-log-streams \
  --log-group-name /aws/bedrock/agentcore/recipe-extraction-agent \
  --order-by LastEventTime \
  --descending \
  --limit 5 \
  --region us-west-2
```

**Expected output:**

```json
{
  "logStreams": [
    {
      "logStreamName": "localhost-2026-03-05T16-36-35-559Z",
      "lastEventTimestamp": 1772728616558
    }
  ]
}
```

**If no log streams exist:**

- The container has never started, or `BEDROCK_AGENT_ID` is not set (so CloudWatch streaming is disabled)
- The IAM role may lack `logs:CreateLogStream` permission
- The log group name in the policy may not match the actual log group

---

## Step 5: Verify App Logs Are Being Written

Invoke the agent and then query for logs with a time-bounded filter.

### 5a. Invoke the agent

```bash
aws bedrock-agentcore invoke-agent-runtime \
  --agent-runtime-arn "arn:aws:bedrock-agentcore:us-west-2:<ACCOUNT_ID>:runtime/<RUNTIME_ID>" \
  --content-type "application/json" \
  --runtime-session-id "$(uuidgen)-$(uuidgen)" \
  --payload '{"url":"https://pinchofyum.com/chicken-wontons-in-spicy-chili-sauce"}' \
  --cli-binary-format raw-in-base64-out \
  --cli-read-timeout 120 \
  --region us-west-2 /dev/stdout
```

> **Note:** `--runtime-session-id` must be at least 33 characters. A double UUID (`$(uuidgen)-$(uuidgen)`) satisfies this.

### 5b. Wait 15 seconds, then query logs

```bash
aws logs filter-log-events \
  --log-group-name /aws/bedrock/agentcore/recipe-extraction-agent \
  --start-time $(($(date +%s) * 1000 - 120000)) \
  --region us-west-2
```

**Expected output includes messages like:**

| Message | Description |
|---------|-------------|
| `Server listening on port 8080` | Container startup |
| `incoming request` | Fastify received the POST |
| `Extracting recipe` | Handler started (with URL + sessionId) |
| `Agent invocation starting` | Bedrock model call initiated |
| `Agent invocation complete` | Model returned (with `agentDurationMs`) |
| `Parsing agent response` | Extracting JSON (with `responseLength`) |
| `Recipe extracted successfully` | Validated recipe (with `title`, `ingredientCount`) |
| `Request complete` | Total duration (with `totalDurationMs`) |
| `request completed` | Fastify response sent (with `statusCode`) |

**If you see only startup logs but no request logs:**

- The CloudWatch stream buffer flushes every 1 second — wait a bit longer and retry
- Multiple log streams are created (one per container instance). The request logs may be in a different stream than the one you're looking at. Always use `filter-log-events` (searches all streams) instead of `get-log-events` (single stream only)

**If you see no logs at all:**

- Go back to Step 1 and verify `BEDROCK_AGENT_ID` is set
- Go back to Step 2 and verify the log group exists
- Go back to Step 3 and verify IAM permissions

---

## Step 6: View Logs in the CloudWatch Console

1. Open the [CloudWatch Console](https://console.aws.amazon.com/cloudwatch/home) and ensure you're in **us-west-2**
2. Navigate to **Logs > Log groups**
3. Search for: `/aws/bedrock/agentcore/recipe-extraction-agent`
4. Click the log group, then click **Search all log streams** to see events across all streams

> **Common mistake:** Clicking into a single log stream. The app creates many streams (one per container cold start). Request-level logs often land in a different stream than the most recent one sorted by `LastEventTime`. Always use **Search all log streams** or the CLI `filter-log-events` command.

---

## Quick Reference: All CLI Commands

```bash
# 1. Runtime config
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id <RUNTIME_ID> --region us-west-2

# 2. Log group exists?
aws logs describe-log-groups \
  --log-group-name-prefix /aws/bedrock/agentcore/recipe-extraction-agent \
  --region us-west-2

# 3. IAM policies
aws iam get-role-policy --role-name BedrockAgentCoreRecipeAgent \
  --policy-name CloudWatchLogs
aws iam get-role --role-name BedrockAgentCoreRecipeAgent \
  --query 'Role.AssumeRolePolicyDocument'

# 4. Log streams
aws logs describe-log-streams \
  --log-group-name /aws/bedrock/agentcore/recipe-extraction-agent \
  --order-by LastEventTime --descending --limit 5 --region us-west-2

# 5. Search logs (all streams, last 5 minutes)
aws logs filter-log-events \
  --log-group-name /aws/bedrock/agentcore/recipe-extraction-agent \
  --start-time $(($(date +%s) * 1000 - 300000)) \
  --region us-west-2

# 6. Search for specific log messages
aws logs filter-log-events \
  --log-group-name /aws/bedrock/agentcore/recipe-extraction-agent \
  --start-time $(($(date +%s) * 1000 - 300000)) \
  --filter-pattern "Extracting" \
  --region us-west-2
```

---

## This is NOT the Bedrock Model Invocation Logging

This guide covers **agent app logs** (your handler code, tool calls, AIRS scans). Bedrock model invocation logs (the raw model request/response payloads) are a separate system configured at the account level:

```bash
# Check model invocation logging config (separate from app logs)
aws bedrock get-model-invocation-logging-configuration --region us-west-2
```

That config controls S3 and CloudWatch delivery for model invocation payloads. See [Part 4: Observability](./deployment-guide/04-observability-cloudwatch-logs.md) for details on the app logging architecture.
