# Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` for local development.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AWS_REGION` | `us-west-2` | AWS region for Bedrock and CloudWatch |
| `PANW_AI_SEC_API_KEY` | — | Prisma AIRS API key (enables security scanning) |
| `PRISMA_AIRS_PROFILE_NAME` | — | AIRS security profile name (required with API key) |
| `BEDROCK_AGENT_ID` | — | Enables CloudWatch log streaming when set |
| `AWS_ACCOUNT_ID` | — | Used in AIRS agent metadata |

## Secrets Manager

In production (when `BEDROCK_AGENT_ID` is set), `src/main.ts` attempts to fetch the AIRS API key from AWS Secrets Manager before falling back to the environment variable:

```
Secret ID: recipe-agent/prisma-airs-api-key
```

This avoids storing the API key in the AgentCore runtime environment variables. See [AWS Infrastructure Setup](../deployment-guide/06-aws-infrastructure-setup.md) for the Secrets Manager IAM policy.

## AIRS Security Scanning

[Prisma AIRS](https://docs.paloaltonetworks.com/ai-runtime-security) (part of Strata Cloud Manager) secures AI agents that consume external data — scanning for prompt injection, URL threats, DLP violations, agent hijacking, and more.

Both `PANW_AI_SEC_API_KEY` and `PRISMA_AIRS_PROFILE_NAME` must be set to enable scanning. If either is missing, the agent operates normally without security checks (fail-open).

When enabled, every request passes through two checkpoints:

1. **Pre-scan** — prompt and fetched content checked for injection, malicious URLs, DLP violations
2. **Post-scan** — response JSON checked for data leaks, toxic content, policy violations

See [Security with Prisma AIRS](../deployment-guide/03-security-with-prisma-airs.md) for details.

## CloudWatch Logging

Set `BEDROCK_AGENT_ID` to enable structured JSON logging to CloudWatch. The log group is:

```
/aws/bedrock/agentcore/recipe-extraction-agent
```

Without this variable, logs go to stdout only. See [Observability](../deployment-guide/04-observability-cloudwatch-logs.md) for the full logging architecture.
