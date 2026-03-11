# Environment Variables

## Runtime Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `AWS_REGION` | No | `us-west-2` | AWS region for Bedrock, CloudWatch, and Secrets Manager |
| `PANW_AI_SEC_API_KEY` | No | — | Prisma AIRS API key; enables security scanning when paired with profile name |
| `PRISMA_AIRS_PROFILE_NAME` | No | — | AIRS security profile; required alongside API key |
| `BEDROCK_AGENT_ID` | No | — | AgentCore runtime ID; enables CloudWatch log streaming |
| `AWS_ACCOUNT_ID` | No | — | Populates AIRS agent metadata for Strata Cloud Manager discovery |
| `BEDROCK_AGENT_VERSION` | No | `1` | Agent version in AIRS metadata |

## Behavior Matrix

| `PANW_AI_SEC_API_KEY` | `PRISMA_AIRS_PROFILE_NAME` | Security Scanning |
|---|---|---|
| Set | Set | Enabled (pre + post scan) |
| Set | Missing | Disabled (fail-open) |
| Missing | Set | Disabled (fail-open) |
| Missing | Missing | Disabled (fail-open) |

| `BEDROCK_AGENT_ID` | Logging |
|---|---|
| Set | stdout + CloudWatch Logs |
| Missing | stdout only |

## Secrets Manager

When `PANW_AI_SEC_API_KEY` is not in the environment, `src/main.ts` attempts to fetch it from Secrets Manager:

```
Secret ID: recipe-agent/prisma-airs-api-key
```

This requires the execution role to have `secretsmanager:GetSecretValue` on that secret ARN.

## `.env.example`

```bash
# AWS
AWS_REGION=us-west-2

# Prisma AIRS (optional — both required to enable scanning)
PANW_AI_SEC_API_KEY=
PRISMA_AIRS_PROFILE_NAME=

# AgentCore metadata (set automatically in deployed runtime)
BEDROCK_AGENT_ID=
AWS_ACCOUNT_ID=
```
