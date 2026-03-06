#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Create Secrets Manager secret for PANW_AI_SEC_API_KEY
#
# Usage:
#   PANW_AI_SEC_API_KEY=<key> scripts/setup-secrets.sh
#
# Idempotent: skips creation if secret already exists.
###############################################################################

REGION="${AWS_REGION:-us-west-2}"
SECRET_NAME="recipe-agent/prisma-airs-api-key"

if [[ -z "${PANW_AI_SEC_API_KEY:-}" ]]; then
  echo "ERROR: PANW_AI_SEC_API_KEY env var required" >&2
  exit 1
fi

echo "==> Creating secret: ${SECRET_NAME}"

if aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" --region "${REGION}" &>/dev/null; then
  echo "    Secret already exists. Updating value..."
  aws secretsmanager put-secret-value \
    --secret-id "${SECRET_NAME}" \
    --secret-string "${PANW_AI_SEC_API_KEY}" \
    --region "${REGION}"
  echo "    Updated."
else
  aws secretsmanager create-secret \
    --name "${SECRET_NAME}" \
    --secret-string "${PANW_AI_SEC_API_KEY}" \
    --description "Prisma AIRS API key for recipe-extraction-agent" \
    --region "${REGION}"
  echo "    Created."
fi
