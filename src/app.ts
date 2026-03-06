import {
  AISecSDKException,
  Content,
  init,
  Scanner,
  type ScanResponse,
} from "@cdot65/prisma-airs-sdk";
import { Agent, type AgentResult, BedrockModel } from "@strands-agents/sdk";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { z } from "zod";
import { createCloudWatchStream, createTeeStream } from "./lib/cloudwatch-stream.js";
import { type Recipe, RecipeSchema } from "./schemas/recipe.js";
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

// AIRS SDK initialization
const airsApiKey = process.env.PANW_AI_SEC_API_KEY || "";
const airsProfileName = process.env.PRISMA_AIRS_PROFILE_NAME || "";
export const airsEnabled = Boolean(airsApiKey && airsProfileName);

if (airsEnabled) {
  init({ apiKey: airsApiKey });
}

const scanner = airsEnabled ? new Scanner() : null;

function buildMetadata() {
  const agentId = process.env.BEDROCK_AGENT_ID;
  const region = process.env.AWS_REGION || "us-west-2";
  const accountId = process.env.AWS_ACCOUNT_ID;

  return {
    app_name: "recipe-extraction-agent",
    app_user: "anonymous",
    ai_model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    agent_meta: agentId
      ? {
          agent_id: agentId,
          agent_version: process.env.BEDROCK_AGENT_VERSION || "1",
          agent_arn: accountId
            ? `arn:aws:bedrock:${region}:${accountId}:agent/${agentId}`
            : undefined,
        }
      : undefined,
  };
}

function scanResultFields(scan: ScanResponse) {
  return {
    action: scan.action,
    category: scan.category,
    scanId: scan.scan_id,
    reportId: scan.report_id,
    profileId: scan.profile_id,
    profileName: scan.profile_name,
    trId: scan.tr_id,
    promptDetected: scan.prompt_detected,
    responseDetected: scan.response_detected,
  };
}

function scanErrorFields(err: unknown) {
  if (err instanceof AISecSDKException) {
    return { err: String(err), errorType: err.errorType };
  }
  return { err: String(err) };
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
): Promise<string> => {
  const start = Date.now();

  // Accept {"url": "..."} or {"prompt": "natural language with URL"}
  let url = request.url;
  if (!url && request.prompt) {
    url = extractUrl(request.prompt) ?? undefined;
  }
  if (!url) {
    return JSON.stringify({
      error: "bad_request",
      message: 'No URL found in request. Provide {"url": "..."} or a prompt containing a URL.',
    });
  }

  context.log.info({ url, sessionId: context.sessionId }, "Extracting recipe");

  const prompt = `Extract the recipe from this URL: ${url}`;

  context.log.info({ airsEnabled, airsProfileName: airsProfileName || null }, "AIRS SDK status");

  // Pre-scan: check inbound prompt for threats
  if (scanner) {
    const metadata = buildMetadata();
    context.log.info(
      { promptLength: prompt.length, profileName: airsProfileName, metadata },
      "AIRS prompt scan starting",
    );
    let promptScan: ScanResponse | undefined;
    try {
      promptScan = await scanner.syncScan(
        { profile_name: airsProfileName },
        new Content({ prompt }),
        { sessionId: context.sessionId, metadata },
      );
      context.log.info(
        { ...scanResultFields(promptScan), durationMs: Date.now() - start },
        "AIRS prompt scan complete",
      );
    } catch (err) {
      context.log.error(
        { ...scanErrorFields(err), durationMs: Date.now() - start },
        "AIRS prompt scan failed, proceeding unscanned",
      );
    }

    if (promptScan?.action === "block") {
      context.log.warn(
        { category: promptScan.category, scanId: promptScan.scan_id },
        "Request blocked by AIRS",
      );
      return JSON.stringify({
        error: "blocked",
        message: "Request blocked by Prisma AIRS security.",
        category: promptScan.category,
        scan_id: promptScan.scan_id,
      });
    }
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
    return JSON.stringify({
      error: "agent_error",
      message: `Agent invocation failed: ${String(err)}`,
    });
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
    return JSON.stringify({
      error: "parse_error",
      message: `Failed to parse recipe: ${String(err)}`,
    });
  }

  context.log.info(
    { title: recipe.title, ingredientCount: recipe.ingredients.length },
    "Recipe extracted successfully",
  );

  // Post-scan: check outbound response for threats
  if (scanner) {
    const responseBody = JSON.stringify(recipe);
    const metadata = buildMetadata();
    context.log.info(
      {
        promptLength: prompt.length,
        responseLength: responseBody.length,
        profileName: airsProfileName,
        metadata,
      },
      "AIRS response scan starting",
    );
    let responseScan: ScanResponse | undefined;
    const responseScanStart = Date.now();
    try {
      responseScan = await scanner.syncScan(
        { profile_name: airsProfileName },
        new Content({ prompt, response: responseBody }),
        { sessionId: context.sessionId, metadata },
      );
      context.log.info(
        { ...scanResultFields(responseScan), durationMs: Date.now() - responseScanStart },
        "AIRS response scan complete",
      );
    } catch (err) {
      context.log.error(
        { ...scanErrorFields(err), durationMs: Date.now() - responseScanStart },
        "AIRS response scan failed, proceeding unscanned",
      );
    }

    if (responseScan?.action === "block") {
      context.log.warn(
        { category: responseScan.category, scanId: responseScan.scan_id },
        "Response blocked by AIRS",
      );
      return JSON.stringify({
        error: "blocked",
        message: "Response blocked by Prisma AIRS security.",
        category: responseScan.category,
        scan_id: responseScan.scan_id,
      });
    }
  }

  const totalDurationMs = Date.now() - start;
  context.log.info({ totalDurationMs, title: recipe.title }, "Request complete");

  return JSON.stringify(recipe);
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
