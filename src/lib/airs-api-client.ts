/**
 * Prisma AIRS AI Runtime Security Client
 *
 * Scans prompts and responses for security threats before/after LLM processing.
 * Adapted from truffles project for BedrockAgentCore agents.
 */
import { randomUUID } from "node:crypto";

export interface AIRSScanRequest {
  tr_id: string;
  session_id?: string;
  ai_profile: {
    profile_name: string;
  };
  metadata?: {
    app_name?: string;
    app_user?: string;
    ai_model?: string;
    agent_meta?: {
      agent_id?: string;
      agent_version?: string;
      agent_arn?: string;
    };
  };
  contents: Array<{
    prompt?: string;
    response?: string;
  }>;
}

export interface AIRSDetectionFlags {
  agent?: boolean;
  db_security?: boolean;
  dlp?: boolean;
  injection?: boolean;
  malicious_code?: boolean;
  toxic_content?: boolean;
  url_cats?: boolean;
}

export interface AIRSScanResponse {
  action: "allow" | "block";
  category: string;
  profile_id: string;
  profile_name: string;
  prompt_detected?: AIRSDetectionFlags;
  response_detected?: AIRSDetectionFlags;
  report_id?: string;
  scan_id: string;
  tr_id: string;
}

export class PrismaAIRSClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly profileName: string;

  constructor(config?: {
    apiUrl?: string;
    apiKey?: string;
    profileName?: string;
  }) {
    this.apiUrl =
      config?.apiUrl ||
      process.env.PRISMA_AIRS_API_URL ||
      "https://service.api.aisecurity.paloaltonetworks.com/v1/scan/sync/request";
    this.apiKey = config?.apiKey || process.env.PRISMA_AIRS_API_KEY || "";
    this.profileName = config?.profileName || process.env.PRISMA_AIRS_PROFILE_NAME || "";
  }

  async scanPrompt(
    prompt: string,
    metadata?: {
      sessionId?: string;
      appUser?: string;
    },
  ): Promise<AIRSScanResponse | null> {
    if (!this.apiKey) return null;

    const request: AIRSScanRequest = {
      tr_id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
      session_id: metadata?.sessionId,
      ai_profile: { profile_name: this.profileName },
      metadata: this.buildMetadata(metadata?.appUser),
      contents: [{ prompt }],
    };

    return this.send(request);
  }

  async scanResponse(
    response: string,
    originalPrompt: string,
    metadata?: {
      sessionId?: string;
      appUser?: string;
    },
  ): Promise<AIRSScanResponse | null> {
    if (!this.apiKey) return null;

    const request: AIRSScanRequest = {
      tr_id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
      session_id: metadata?.sessionId,
      ai_profile: { profile_name: this.profileName },
      metadata: this.buildMetadata(metadata?.appUser),
      contents: [{ prompt: originalPrompt, response }],
    };

    return this.send(request);
  }

  isEnabled(): boolean {
    return Boolean(this.apiKey && this.profileName);
  }

  private buildMetadata(appUser?: string): AIRSScanRequest["metadata"] {
    const agentId = process.env.BEDROCK_AGENT_ID;
    const region = process.env.AWS_REGION || "us-west-2";
    const accountId = process.env.AWS_ACCOUNT_ID;

    return {
      app_name: "recipe-extraction-agent",
      app_user: appUser || "anonymous",
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

  private async send(request: AIRSScanRequest): Promise<AIRSScanResponse | null> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "x-pan-token": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        console.error(`AIRS API error: ${response.status} ${response.statusText}`);
        return null;
      }

      return (await response.json()) as AIRSScanResponse;
    } catch (error) {
      console.error("AIRS API request failed:", error);
      return null;
    }
  }
}
