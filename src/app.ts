import { Agent, type AgentResult, BedrockModel } from "@strands-agents/sdk";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { z } from "zod";
import { airsEnabled, postScan, preScan } from "./lib/airs-scanner.js";
import { createCloudWatchStream, createTeeStream } from "./lib/cloudwatch-stream.js";
import { type Recipe, RecipeSchema } from "./schemas/recipe.js";
import { fetchUrlTool } from "./tools/fetch-url.js";

export { airsEnabled } from "./lib/airs-scanner.js";

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
  "notes": {  // optional — omit entirely if no metadata available
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

const URL_REGEX = /https?:\/\/[^\s"'<>]+/;

export function extractUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
}

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

export const processHandler = async (
  request: { url?: string; prompt?: string },
  context: {
    sessionId: string;
    log: {
      info: (obj: unknown, msg: string) => void;
      warn: (obj: unknown, msg: string) => void;
      error: (obj: unknown, msg: string) => void;
    };
  },
): Promise<Recipe | { error: string; message: string; [key: string]: unknown }> => {
  const start = Date.now();

  // Accept {"url": "..."} or {"prompt": "natural language with URL"}
  let url = request.url;
  if (!url && request.prompt) {
    url = extractUrl(request.prompt) ?? undefined;
  }
  if (!url) {
    return {
      error: "bad_request",
      message: 'No URL found in request. Provide {"url": "..."} or a prompt containing a URL.',
    };
  }

  context.log.info({ url, sessionId: context.sessionId }, "Extracting recipe");

  const prompt = `Extract the recipe from this URL: ${url}`;

  context.log.info(
    { airsEnabled, airsProfileName: process.env.PRISMA_AIRS_PROFILE_NAME || null },
    "AIRS SDK status",
  );

  // Pre-scan: check inbound prompt for threats
  const preScanResult = await preScan(prompt, context.sessionId, context.log);
  if (preScanResult.blocked && preScanResult.blockResponse) {
    return preScanResult.blockResponse;
  }

  const agentStart = Date.now();
  context.log.info(
    { model: "us.anthropic.claude-haiku-4-5-20251001-v1:0" },
    "Agent invocation starting",
  );

  let result: AgentResult;
  try {
    result = await agent.invoke(prompt);
  } catch (err) {
    context.log.error(
      { error: String(err), durationMs: Date.now() - agentStart },
      "Agent invocation failed",
    );
    return { error: "agent_error", message: `Agent invocation failed: ${String(err)}` };
  }

  const agentDurationMs = Date.now() - agentStart;
  context.log.info({ agentDurationMs }, "Agent invocation complete");

  const responseText = result.toString();
  context.log.info({ responseLength: responseText.length }, "Parsing agent response");

  let recipe: Recipe;
  try {
    const parsed = extractJson(responseText);
    recipe = RecipeSchema.parse(parsed);
  } catch (err) {
    context.log.error(
      { error: String(err), responsePreview: responseText.slice(0, 200) },
      "Failed to parse recipe from agent response",
    );
    return { error: "parse_error", message: `Failed to parse recipe: ${String(err)}` };
  }

  context.log.info(
    { title: recipe.title, ingredientCount: recipe.ingredients.length },
    "Recipe extracted successfully",
  );

  // Post-scan: check outbound response for threats
  const postScanResult = await postScan(
    prompt,
    JSON.stringify(recipe),
    context.sessionId,
    context.log,
  );
  if (postScanResult.blocked && postScanResult.blockResponse) {
    return postScanResult.blockResponse;
  }

  const totalDurationMs = Date.now() - start;
  context.log.info({ totalDurationMs, title: recipe.title }, "Request complete");

  return recipe;
};

const LOG_GROUP = "/aws/bedrock/agentcore/recipe-extraction-agent";
const region = process.env.AWS_REGION || "us-west-2";

/* v8 ignore start -- module-level env branch; tested via deploy */
const logStream = process.env.BEDROCK_AGENT_ID
  ? createTeeStream(process.stdout, createCloudWatchStream(LOG_GROUP, region))
  : process.stdout;
/* v8 ignore stop */

export const app = new BedrockAgentCoreApp({
  config: { logging: { options: { stream: logStream } } },
  invocationHandler: {
    requestSchema: z.object({
      url: z.string().url().describe("URL of the recipe page to extract").optional(),
      prompt: z.string().describe("Natural language prompt containing a recipe URL").optional(),
    }),
    process: processHandler,
  },
});
