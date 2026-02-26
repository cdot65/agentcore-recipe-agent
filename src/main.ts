import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { app } from "./app.js";

async function bootstrap() {
  if (!process.env.PRISMA_AIRS_API_KEY) {
    try {
      const sm = new SecretsManagerClient({
        region: process.env.AWS_REGION || "us-west-2",
      });
      const secret = await sm.send(
        new GetSecretValueCommand({
          SecretId: "recipe-agent/prisma-airs-api-key",
        }),
      );
      if (secret.SecretString) {
        process.env.PRISMA_AIRS_API_KEY = secret.SecretString;
      }
    } catch {
      console.warn("Secrets Manager unavailable, using env var for PRISMA_AIRS_API_KEY");
    }
  }
  app.run();
}

bootstrap();
