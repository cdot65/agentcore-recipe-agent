import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIRSScanResponse } from "../../../src/lib/airs-api-client.js";
import { PrismaAIRSClient } from "../../../src/lib/airs-api-client.js";

const mockResponse: AIRSScanResponse = {
  action: "allow",
  category: "safe",
  profile_id: "prof-1",
  profile_name: "Test Profile",
  scan_id: "scan-1",
  tr_id: "tr-1",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    headers: { "Content-Type": "application/json" },
  });
}

describe("PrismaAIRSClient", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubEnv("PRISMA_AIRS_API_KEY", "");
    vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "");
    vi.stubEnv("PRISMA_AIRS_API_URL", "");
    vi.stubEnv("BEDROCK_AGENT_ID", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_ACCOUNT_ID", "");
    vi.stubEnv("BEDROCK_AGENT_VERSION", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("constructor", () => {
    it("uses config values over env vars", () => {
      vi.stubEnv("PRISMA_AIRS_API_KEY", "env-key");
      const client = new PrismaAIRSClient({ apiKey: "config-key", profileName: "P" });
      expect(client.isEnabled()).toBe(true);
    });

    it("falls back to env vars", () => {
      vi.stubEnv("PRISMA_AIRS_API_KEY", "env-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "env-profile");
      const client = new PrismaAIRSClient();
      expect(client.isEnabled()).toBe(true);
    });

    it("defaults to empty strings when nothing set", () => {
      const client = new PrismaAIRSClient();
      expect(client.isEnabled()).toBe(false);
    });
  });

  describe("isEnabled", () => {
    it("returns false when apiKey is missing", () => {
      const client = new PrismaAIRSClient({ profileName: "P" });
      expect(client.isEnabled()).toBe(false);
    });

    it("returns false when profileName is missing", () => {
      const client = new PrismaAIRSClient({ apiKey: "k" });
      expect(client.isEnabled()).toBe(false);
    });

    it("returns true when both are set", () => {
      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });
      expect(client.isEnabled()).toBe(true);
    });
  });

  describe("scanPrompt", () => {
    it("returns null when apiKey is empty", async () => {
      const client = new PrismaAIRSClient({ profileName: "P" });
      const result = await client.scanPrompt("hello");
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("sends correct request and returns response", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));
      const client = new PrismaAIRSClient({
        apiKey: "test-key",
        profileName: "Test",
        apiUrl: "https://airs.test/scan",
      });

      const result = await client.scanPrompt("test prompt", { sessionId: "s1", appUser: "user1" });

      expect(result).toEqual(mockResponse);
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://airs.test/scan");
      expect(opts?.method).toBe("POST");
      expect((opts?.headers as Record<string, string>)["x-pan-token"]).toBe("test-key");
      const body = JSON.parse(opts?.body as string);
      expect(body.contents).toEqual([{ prompt: "test prompt" }]);
      expect(body.session_id).toBe("s1");
      expect(body.ai_profile.profile_name).toBe("Test");
      expect(body.metadata.app_user).toBe("user1");
    });

    it("returns null on HTTP error", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "bad" }, 400));
      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });
      const result = await client.scanPrompt("test");
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("network fail"));
      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });
      const result = await client.scanPrompt("test");
      expect(result).toBeNull();
    });
  });

  describe("scanResponse", () => {
    it("returns null when apiKey is empty", async () => {
      const client = new PrismaAIRSClient({ profileName: "P" });
      const result = await client.scanResponse("response", "prompt");
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("sends prompt and response in contents", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));
      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });

      await client.scanResponse("the response", "the prompt", { sessionId: "s2" });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.contents).toEqual([{ prompt: "the prompt", response: "the response" }]);
      expect(body.session_id).toBe("s2");
    });
  });

  describe("buildMetadata", () => {
    it("includes agent_meta when BEDROCK_AGENT_ID is set", async () => {
      vi.stubEnv("BEDROCK_AGENT_ID", "agent-123");
      vi.stubEnv("AWS_REGION", "us-east-1");
      vi.stubEnv("AWS_ACCOUNT_ID", "111222333");
      vi.stubEnv("BEDROCK_AGENT_VERSION", "3");
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));

      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });
      await client.scanPrompt("test");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.metadata.agent_meta).toEqual({
        agent_id: "agent-123",
        agent_version: "3",
        agent_arn: "arn:aws:bedrock:us-east-1:111222333:agent/agent-123",
      });
    });

    it("omits agent_meta when BEDROCK_AGENT_ID is not set", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));
      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });
      await client.scanPrompt("test");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.metadata.agent_meta).toBeUndefined();
    });

    it("omits agent_arn when AWS_ACCOUNT_ID is not set", async () => {
      vi.stubEnv("BEDROCK_AGENT_ID", "agent-123");
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));

      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });
      await client.scanPrompt("test");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.metadata.agent_meta.agent_arn).toBeUndefined();
    });

    it("defaults app_user to anonymous", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));
      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });
      await client.scanPrompt("test");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.metadata.app_user).toBe("anonymous");
    });

    it("defaults region to us-west-2", async () => {
      vi.stubEnv("BEDROCK_AGENT_ID", "agent-123");
      vi.stubEnv("AWS_ACCOUNT_ID", "111");
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));

      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });
      await client.scanPrompt("test");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.metadata.agent_meta.agent_arn).toContain("us-west-2");
    });

    it("defaults agent_version to 1", async () => {
      vi.stubEnv("BEDROCK_AGENT_ID", "agent-123");
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));

      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });
      await client.scanPrompt("test");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.metadata.agent_meta.agent_version).toBe("1");
    });
  });

  describe("env var fallbacks", () => {
    it("uses PRISMA_AIRS_API_URL env var", async () => {
      vi.stubEnv("PRISMA_AIRS_API_URL", "https://custom.test/scan");
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));

      const client = new PrismaAIRSClient({ apiKey: "k", profileName: "P" });
      await client.scanPrompt("test");

      expect(fetchSpy.mock.calls[0][0]).toBe("https://custom.test/scan");
    });
  });
});
