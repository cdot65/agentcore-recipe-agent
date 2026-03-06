import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

async function bootstrap() {
  if (!process.env.PANW_AI_SEC_API_KEY) {
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
        process.env.PANW_AI_SEC_API_KEY = secret.SecretString;
      }
    } catch {
      console.warn("Secrets Manager unavailable, using env var for PANW_AI_SEC_API_KEY");
    }
  }

  // Dynamic import so app.ts module-level init() sees the env var
  const { app } = await import("./app.js");
  app.run();
}

bootstrap();
