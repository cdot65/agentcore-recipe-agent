import { Agent, type AgentResult, BedrockModel } from "@strands-agents/sdk";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { z } from "zod";
import { PrismaAIRSClient } from "./lib/airs-api-client.js";
import { RecipeSchema } from "./schemas/recipe.js";
import { fetchUrlTool } from "./tools/fetch-url.js";

export const SYSTEM_PROMPT = `You are a recipe extraction agent. When given a URL:

1. Use the fetch_url tool to retrieve the webpage content.
2. Analyze the returned text and any JSON-LD data to extract the recipe.
3. Return ONLY a valid JSON object matching this exact schema (no markdown, no explanation):

{
  "title": "string",
  "ingredients": [
    { "quantity": number, "unit": "string", "name": "string", "description": "string" }
  ],
  "preparationSteps": ["string"],
  "cookingSteps": ["string"],
  "notes": {
    "servings": "string or omit",
    "cookTime": "string or omit",
    "prepTime": "string or omit",
    "tips": ["string"] or omit
  }
}

Rules:
- quantity must be a number (convert fractions: ½=0.5, ¼=0.25, ⅓=0.33, ¾=0.75, etc.)
- unit is empty string "" if the ingredient is unitless (e.g. "2 eggs" → unit: "")
- description is empty string "" if no preparation notes exist
- Separate preparation steps (no heat: chopping, mixing, marinating) from cooking steps (involving heat or the actual cook)
- If JSON-LD data is available, prefer it for accuracy but still verify against the page text
- Return ONLY the JSON object, nothing else`;

const model = new BedrockModel({
  modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  region: "us-west-2",
  maxTokens: 4096,
  temperature: 0,
});

export const agent = new Agent({
  model,
  tools: [fetchUrlTool],
  systemPrompt: SYSTEM_PROMPT,
  printer: false,
});

export function extractJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Fall through
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // Fall through
    }
  }

  // Try finding first { ... } block
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1));
    } catch {
      // Fall through
    }
  }

  throw new Error("Could not extract JSON from agent response");
}

const airsClient = new PrismaAIRSClient();

export const processHandler = async (
  request: { url: string },
  context: {
    sessionId: string;
    log: {
      info: (obj: unknown, msg: string) => void;
      warn: (obj: unknown, msg: string) => void;
    };
  },
) => {
  context.log.info({ url: request.url }, "Extracting recipe");

  const prompt = `Extract the recipe from this URL: ${request.url}`;
  const scanMeta = { sessionId: context.sessionId };

  // Pre-scan: check inbound prompt for threats
  if (airsClient.isEnabled()) {
    const promptScan = await airsClient.scanPrompt(prompt, scanMeta);
    context.log.info(
      { action: promptScan?.action, scanId: promptScan?.scan_id },
      "AIRS prompt scan",
    );

    if (promptScan?.action === "block") {
      return {
        error: "blocked",
        message: "Request blocked by Prisma AIRS security.",
        category: promptScan.category,
        scan_id: promptScan.scan_id,
      };
    }
  }

  const result: AgentResult = await agent.invoke(prompt);

  const responseText = result.toString();
  const parsed = extractJson(responseText);
  const recipe = RecipeSchema.parse(parsed);

  // Post-scan: check outbound response for threats
  if (airsClient.isEnabled()) {
    const responseScan = await airsClient.scanResponse(JSON.stringify(recipe), prompt, scanMeta);
    context.log.info(
      { action: responseScan?.action, scanId: responseScan?.scan_id },
      "AIRS response scan",
    );

    if (responseScan?.action === "block") {
      return {
        error: "blocked",
        message: "Response blocked by Prisma AIRS security.",
        category: responseScan.category,
        scan_id: responseScan.scan_id,
      };
    }
  }

  return recipe;
};

export const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: z.object({
      url: z.string().url().describe("URL of the recipe page to extract"),
    }),
    process: processHandler,
  },
});
