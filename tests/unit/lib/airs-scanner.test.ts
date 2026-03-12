import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSyncScan, MockAISecSDKException } = vi.hoisted(() => {
  class MockAISecSDKException extends Error {
    name = "AISecSDKException";
    constructor(
      message: string,
      public errorType?: string,
    ) {
      super(errorType ? `${errorType}:${message}` : message);
    }
  }
  return {
    mockSyncScan: vi.fn(),
    MockAISecSDKException,
  };
});

vi.mock("@cdot65/prisma-airs-sdk", () => ({
  init: vi.fn(),
  Scanner: class {
    syncScan = mockSyncScan;
  },
  Content: class {
    constructor(public opts: unknown) {}
  },
  AISecSDKException: MockAISecSDKException,
}));

function mockLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const fullScanResponse = {
  action: "allow",
  category: "benign",
  scan_id: "s1",
  report_id: "r1",
  profile_id: "prof-1",
  profile_name: "test-profile",
  tr_id: "tr-1",
  prompt_detected: { injection: false },
  response_detected: undefined,
};

describe("airs-scanner", () => {
  beforeEach(() => {
    mockSyncScan.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("airsEnabled", () => {
    it("is false when env vars are missing", async () => {
      const { airsEnabled } = await import("../../../src/lib/airs-scanner.js");
      expect(airsEnabled).toBe(false);
    });

    it("is true when both env vars are set", async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");

      const { airsEnabled } = await import("../../../src/lib/airs-scanner.js");
      expect(airsEnabled).toBe(true);
    });

    it("is false when only API key is set", async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");

      const { airsEnabled } = await import("../../../src/lib/airs-scanner.js");
      expect(airsEnabled).toBe(false);
    });

    it("is false when only profile name is set", async () => {
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");

      const { airsEnabled } = await import("../../../src/lib/airs-scanner.js");
      expect(airsEnabled).toBe(false);
    });
  });

  describe("preScan", () => {
    beforeEach(() => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");
    });

    it("returns non-blocked when scanner allows", async () => {
      mockSyncScan.mockResolvedValueOnce(fullScanResponse);
      const { preScan } = await import("../../../src/lib/airs-scanner.js");
      const log = mockLog();

      const result = await preScan("test prompt", "session-1", log);

      expect(result).toEqual({ blocked: false });
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ action: "allow" }),
        "AIRS prompt scan complete",
      );
    });

    it("returns blocked response when scanner blocks", async () => {
      mockSyncScan.mockResolvedValueOnce({
        action: "block",
        category: "injection",
        scan_id: "s-blocked",
      });
      const { preScan } = await import("../../../src/lib/airs-scanner.js");
      const log = mockLog();

      const result = await preScan("test prompt", "session-1", log);

      expect(result.blocked).toBe(true);
      expect(result.blockResponse).toEqual({
        error: "blocked",
        message: "Request blocked by Prisma AIRS security.",
        category: "injection",
        scan_id: "s-blocked",
      });
    });

    it("handles scanner errors gracefully", async () => {
      mockSyncScan.mockRejectedValueOnce(new Error("AIRS timeout"));
      const { preScan } = await import("../../../src/lib/airs-scanner.js");
      const log = mockLog();

      const result = await preScan("test prompt", "session-1", log);

      expect(result).toEqual({ blocked: false });
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.stringContaining("AIRS timeout") }),
        "AIRS prompt scan failed, proceeding unscanned",
      );
    });

    it("returns non-blocked when scanner is disabled", async () => {
      vi.unstubAllEnvs();
      vi.resetModules();
      const { preScan } = await import("../../../src/lib/airs-scanner.js");
      const log = mockLog();

      const result = await preScan("test prompt", "session-1", log);

      expect(result).toEqual({ blocked: false });
      expect(mockSyncScan).not.toHaveBeenCalled();
    });
  });

  describe("postScan", () => {
    beforeEach(() => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");
    });

    it("returns non-blocked when scanner allows", async () => {
      mockSyncScan.mockResolvedValueOnce(fullScanResponse);
      const { postScan } = await import("../../../src/lib/airs-scanner.js");
      const log = mockLog();

      const result = await postScan("test prompt", '{"recipe": true}', "session-1", log);

      expect(result).toEqual({ blocked: false });
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ action: "allow" }),
        "AIRS response scan complete",
      );
    });

    it("returns blocked response when scanner blocks", async () => {
      mockSyncScan.mockResolvedValueOnce({
        action: "block",
        category: "dlp",
        scan_id: "s-resp-blocked",
      });
      const { postScan } = await import("../../../src/lib/airs-scanner.js");
      const log = mockLog();

      const result = await postScan("test prompt", '{"recipe": true}', "session-1", log);

      expect(result.blocked).toBe(true);
      expect(result.blockResponse).toEqual({
        error: "blocked",
        message: "Response blocked by Prisma AIRS security.",
        category: "dlp",
        scan_id: "s-resp-blocked",
      });
    });

    it("handles scanner errors gracefully", async () => {
      mockSyncScan.mockRejectedValueOnce(new Error("AIRS timeout"));
      const { postScan } = await import("../../../src/lib/airs-scanner.js");
      const log = mockLog();

      const result = await postScan("test prompt", '{"recipe": true}', "session-1", log);

      expect(result).toEqual({ blocked: false });
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.stringContaining("AIRS timeout") }),
        "AIRS response scan failed, proceeding unscanned",
      );
    });

    it("returns non-blocked when scanner is disabled", async () => {
      vi.unstubAllEnvs();
      vi.resetModules();
      const { postScan } = await import("../../../src/lib/airs-scanner.js");
      const log = mockLog();

      const result = await postScan("test prompt", '{"recipe": true}', "session-1", log);

      expect(result).toEqual({ blocked: false });
      expect(mockSyncScan).not.toHaveBeenCalled();
    });
  });

  describe("buildMetadata", () => {
    it("includes agent_meta when BEDROCK_AGENT_ID is set", async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");
      vi.stubEnv("BEDROCK_AGENT_ID", "agent-123");
      vi.stubEnv("AWS_REGION", "us-east-1");
      vi.stubEnv("AWS_ACCOUNT_ID", "111222333");
      vi.stubEnv("BEDROCK_AGENT_VERSION", "3");

      const { buildMetadata } = await import("../../../src/lib/airs-scanner.js");
      const metadata = buildMetadata();

      expect(metadata.agent_meta).toEqual({
        agent_id: "agent-123",
        agent_version: "3",
        agent_arn: "arn:aws:bedrock:us-east-1:111222333:agent/agent-123",
      });
    });

    it("omits agent_meta when BEDROCK_AGENT_ID is not set", async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");

      const { buildMetadata } = await import("../../../src/lib/airs-scanner.js");
      const metadata = buildMetadata();

      expect(metadata.agent_meta).toBeUndefined();
    });

    it("omits agent_arn when AWS_ACCOUNT_ID is not set", async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");
      vi.stubEnv("BEDROCK_AGENT_ID", "agent-456");

      const { buildMetadata } = await import("../../../src/lib/airs-scanner.js");
      const metadata = buildMetadata();

      expect(metadata.agent_meta?.agent_arn).toBeUndefined();
    });

    it("defaults agent_version to 1", async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");
      vi.stubEnv("BEDROCK_AGENT_ID", "agent-456");

      const { buildMetadata } = await import("../../../src/lib/airs-scanner.js");
      const metadata = buildMetadata();

      expect(metadata.agent_meta?.agent_version).toBe("1");
    });

    it("includes standard app fields", async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");

      const { buildMetadata } = await import("../../../src/lib/airs-scanner.js");
      const metadata = buildMetadata();

      expect(metadata.app_name).toBe("recipe-extraction-agent");
      expect(metadata.app_user).toBe("anonymous");
      expect(metadata.ai_model).toBe("us.anthropic.claude-haiku-4-5-20251001-v1:0");
    });
  });

  describe("scanResultFields", () => {
    it("maps ScanResponse fields correctly", async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");

      const { scanResultFields } = await import("../../../src/lib/airs-scanner.js");
      const result = scanResultFields(fullScanResponse);

      expect(result).toEqual({
        action: "allow",
        category: "benign",
        scanId: "s1",
        reportId: "r1",
        profileId: "prof-1",
        profileName: "test-profile",
        trId: "tr-1",
        promptDetected: { injection: false },
        responseDetected: undefined,
      });
    });
  });

  describe("scanErrorFields", () => {
    it("handles AISecSDKException with errorType", async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");

      const { scanErrorFields } = await import("../../../src/lib/airs-scanner.js");
      const err = new MockAISecSDKException("API error 500", "AISEC_SERVER_SIDE_ERROR");
      const result = scanErrorFields(err);

      expect(result).toEqual({
        err: expect.stringContaining("AISEC_SERVER_SIDE_ERROR"),
        errorType: "AISEC_SERVER_SIDE_ERROR",
      });
    });

    it("handles plain errors", async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");

      const { scanErrorFields } = await import("../../../src/lib/airs-scanner.js");
      const err = new Error("network failure");
      const result = scanErrorFields(err);

      expect(result).toEqual({ err: "Error: network failure" });
      expect(result).not.toHaveProperty("errorType");
    });
  });
});
