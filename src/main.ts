import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

async function bootstrap() {
  const region = process.env.AWS_REGION || "us-west-2";
  let secretSource = "env";

  if (!process.env.PANW_AI_SEC_API_KEY) {
    try {
      const sm = new SecretsManagerClient({ region });
      const secret = await sm.send(
        new GetSecretValueCommand({
          SecretId: "recipe-agent/prisma-airs-api-key",
        }),
      );
      if (secret.SecretString) {
        process.env.PANW_AI_SEC_API_KEY = secret.SecretString;
        secretSource = "secrets-manager";
      }
    } catch (err) {
      console.warn("Secrets Manager unavailable, using env var for PANW_AI_SEC_API_KEY");
      console.warn("  error:", String(err));
    }
  }

  const apiKey = process.env.PANW_AI_SEC_API_KEY || "";
  console.log(
    JSON.stringify({
      msg: "bootstrap",
      secretSource,
      apiKeySet: Boolean(apiKey),
      apiKeyLength: apiKey.length,
      profileName: process.env.PRISMA_AIRS_PROFILE_NAME || null,
      region,
      bedrockAgentId: process.env.BEDROCK_AGENT_ID || null,
      awsAccountId: process.env.AWS_ACCOUNT_ID || null,
    }),
  );

  // Dynamic import so app.ts module-level init() sees the env var
  const { app } = await import("./app.js");
  app.run();
}

bootstrap();
