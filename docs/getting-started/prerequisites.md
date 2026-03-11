# Prerequisites

## Required

| Requirement | Details |
|---|---|
| **Node.js** | v20 or later ([download](https://nodejs.org/)) |
| **AWS Account** | With Bedrock access in `us-west-2` |
| **AWS CLI** | v2, configured with credentials (`aws configure`) |
| **Model Access** | `us.anthropic.claude-haiku-4-5-20251001-v1:0` enabled in Bedrock |

## Optional

| Requirement | Details |
|---|---|
| **Docker** | For building the container image (ARM64/Graviton) |
| **GitHub CLI (`gh`)** | For CI/CD setup and GitHub Actions OIDC |
| **Prisma AIRS API Key** | For AI security scanning ([docs](https://docs.paloaltonetworks.com/prisma/prisma-cloud/prisma-cloud-admin/prisma-airs)) |

## Verify Setup

```bash
node --version        # v20+
aws sts get-caller-identity   # confirms credentials
aws bedrock list-foundation-models \
  --region us-west-2 \
  --query "modelSummaries[?modelId=='anthropic.claude-haiku-4-5-20251001-v1:0'].modelId" \
  --output text       # confirms model access
```

!!! tip "Model access"
    If the model query returns empty, enable Claude Haiku 4.5 in the [Bedrock console](https://console.aws.amazon.com/bedrock/home?region=us-west-2#/modelaccess) under **Model access**.
