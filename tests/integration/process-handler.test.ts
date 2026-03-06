import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockSyncScan, MockAISecSDKException } = vi.hoisted(() => {
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
    mockInvoke: vi.fn(),
    mockSyncScan: vi.fn(),
    MockAISecSDKException,
  };
});

vi.mock("@strands-agents/sdk", () => ({
  Agent: class {
    invoke = mockInvoke;
  },
  BedrockModel: class {},
  tool: vi.fn().mockImplementation((config) => config),
}));

vi.mock("bedrock-agentcore/runtime", () => ({
  BedrockAgentCoreApp: class {
    run = vi.fn();
    constructor(public config: unknown) {}
  },
}));

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

import { processHandler } from "../../src/app.js";

const validRecipe = {
  title: "Test Pasta",
  ingredients: [{ quantity: 2, unit: "cups", name: "flour", description: "" }],
  preparationSteps: ["Mix dough"],
  cookingSteps: ["Boil for 10 min"],
  notes: { servings: "4" },
};

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

function mockContext() {
  return {
    sessionId: "test-session-id",
    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
}

function mockAgentResult(text: string) {
  return { toString: () => text };
}

describe("processHandler", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockSyncScan.mockReset();
  });

  it("returns validated recipe from direct JSON response", async () => {
    mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(validRecipe)));

    const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

    expect(JSON.parse(result)).toEqual(validRecipe);
  });

  it("handles markdown-wrapped JSON response", async () => {
    mockInvoke.mockResolvedValueOnce(
      mockAgentResult(`\`\`\`json\n${JSON.stringify(validRecipe)}\n\`\`\``),
    );

    const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

    expect(JSON.parse(result)).toEqual(validRecipe);
  });

  it("handles JSON with surrounding text", async () => {
    mockInvoke.mockResolvedValueOnce(
      mockAgentResult(`Here is the recipe: ${JSON.stringify(validRecipe)} enjoy!`),
    );

    const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

    expect(JSON.parse(result)).toEqual(validRecipe);
  });

  it("returns error object when agent invocation fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Model timeout"));

    const ctx = mockContext();
    const result = await processHandler({ url: "https://example.com/recipe" }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("agent_error");
    expect(parsed.message).toContain("Model timeout");
    expect(ctx.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Error: Model timeout" }),
      "Agent invocation failed",
    );
  });

  it("returns error object when agent returns no JSON", async () => {
    mockInvoke.mockResolvedValueOnce(mockAgentResult("I could not find a recipe on that page."));

    const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("parse_error");
    expect(parsed.message).toContain("Could not extract JSON");
  });

  it("returns error object when JSON fails schema validation", async () => {
    const invalid = { title: "Missing fields" }; // no ingredients, etc.
    mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(invalid)));

    const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("parse_error");
    expect(parsed.message).toContain("Failed to parse recipe");
  });

  it("calls agent.invoke with correct prompt", async () => {
    mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(validRecipe)));

    await processHandler({ url: "https://example.com/recipe" }, mockContext());

    expect(mockInvoke).toHaveBeenCalledWith(
      "Extract the recipe from this URL: https://example.com/recipe",
    );
  });

  it("logs the URL via context.log.info", async () => {
    mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(validRecipe)));

    const ctx = mockContext();
    await processHandler({ url: "https://example.com/recipe" }, ctx);

    expect(ctx.log.info).toHaveBeenCalledWith(
      { url: "https://example.com/recipe", sessionId: "test-session-id" },
      "Extracting recipe",
    );
  });

  it("logs AIRS SDK status as disabled when no env vars", async () => {
    mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(validRecipe)));

    const ctx = mockContext();
    await processHandler({ url: "https://example.com/recipe" }, ctx);

    expect(ctx.log.info).toHaveBeenCalledWith(
      { airsEnabled: false, airsProfileName: null },
      "AIRS SDK status",
    );
  });

  it("returns recipe with all optional notes fields", async () => {
    const fullRecipe = {
      ...validRecipe,
      notes: {
        servings: "4",
        cookTime: "30 min",
        prepTime: "15 min",
        tips: ["Use fresh pasta"],
      },
    };
    mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(fullRecipe)));

    const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

    expect(JSON.parse(result)).toEqual(fullRecipe);
  });

  describe("AIRS integration", () => {
    beforeEach(async () => {
      vi.stubEnv("PANW_AI_SEC_API_KEY", "test-key");
      vi.stubEnv("PRISMA_AIRS_PROFILE_NAME", "test-profile");

      // Re-import to pick up env vars — airsEnabled is evaluated at module load
      vi.resetModules();
      mockSyncScan.mockResolvedValue(fullScanResponse);
      mockInvoke.mockResolvedValue(mockAgentResult(JSON.stringify(validRecipe)));
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("calls syncScan for prompt and response when enabled", async () => {
      const { processHandler: handler, airsEnabled: enabled } = await import("../../src/app.js");
      expect(enabled).toBe(true);

      await handler({ url: "https://example.com/recipe" }, mockContext());

      expect(mockSyncScan).toHaveBeenCalledTimes(2);
    });

    it("logs full scan result fields on prompt scan", async () => {
      const { processHandler: handler } = await import("../../src/app.js");
      const ctx = mockContext();
      await handler({ url: "https://example.com/recipe" }, ctx);

      expect(ctx.log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "allow",
          category: "benign",
          scanId: "s1",
          reportId: "r1",
          profileId: "prof-1",
          profileName: "test-profile",
          trId: "tr-1",
          promptDetected: { injection: false },
          durationMs: expect.any(Number),
        }),
        "AIRS prompt scan complete",
      );
    });

    it("logs content details and metadata on scan start", async () => {
      const { processHandler: handler } = await import("../../src/app.js");
      const ctx = mockContext();
      await handler({ url: "https://example.com/recipe" }, ctx);

      expect(ctx.log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          promptLength: expect.any(Number),
          profileName: "test-profile",
          metadata: expect.objectContaining({
            app_name: "recipe-extraction-agent",
            app_user: "anonymous",
            ai_model: expect.any(String),
          }),
        }),
        "AIRS prompt scan starting",
      );

      expect(ctx.log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          promptLength: expect.any(Number),
          responseLength: expect.any(Number),
          profileName: "test-profile",
          metadata: expect.objectContaining({
            app_name: "recipe-extraction-agent",
          }),
        }),
        "AIRS response scan starting",
      );
    });

    it("logs full scan result fields on response scan", async () => {
      const { processHandler: handler } = await import("../../src/app.js");
      const ctx = mockContext();
      await handler({ url: "https://example.com/recipe" }, ctx);

      expect(ctx.log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "allow",
          category: "benign",
          scanId: "s1",
          reportId: "r1",
          durationMs: expect.any(Number),
        }),
        "AIRS response scan complete",
      );
    });

    it("logs AIRS SDK status as enabled", async () => {
      const { processHandler: handler } = await import("../../src/app.js");
      const ctx = mockContext();
      await handler({ url: "https://example.com/recipe" }, ctx);

      expect(ctx.log.info).toHaveBeenCalledWith(
        { airsEnabled: true, airsProfileName: "test-profile" },
        "AIRS SDK status",
      );
    });

    it("returns blocked response when prompt scan blocks", async () => {
      mockSyncScan.mockResolvedValueOnce({
        action: "block",
        category: "injection",
        scan_id: "s-blocked",
        report_id: "r1",
      });

      const { processHandler: handler } = await import("../../src/app.js");
      const result = await handler({ url: "https://example.com/recipe" }, mockContext());

      expect(JSON.parse(result)).toEqual({
        error: "blocked",
        message: "Request blocked by Prisma AIRS security.",
        category: "injection",
        scan_id: "s-blocked",
      });
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("proceeds unscanned when prompt scan throws", async () => {
      mockSyncScan.mockRejectedValueOnce(new Error("AIRS timeout"));
      mockSyncScan.mockResolvedValueOnce(fullScanResponse);

      const { processHandler: handler } = await import("../../src/app.js");
      const ctx = mockContext();
      const result = await handler({ url: "https://example.com/recipe" }, ctx);

      expect(JSON.parse(result)).toEqual(validRecipe);
      expect(ctx.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.stringContaining("AIRS timeout") }),
        "AIRS prompt scan failed, proceeding unscanned",
      );
    });

    it("logs errorType when AISecSDKException is thrown on prompt scan", async () => {
      mockSyncScan.mockRejectedValueOnce(
        new MockAISecSDKException("API error 500", "AISEC_SERVER_SIDE_ERROR"),
      );
      mockSyncScan.mockResolvedValueOnce(fullScanResponse);

      const { processHandler: handler } = await import("../../src/app.js");
      const ctx = mockContext();
      await handler({ url: "https://example.com/recipe" }, ctx);

      expect(ctx.log.error).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: "AISEC_SERVER_SIDE_ERROR",
          durationMs: expect.any(Number),
        }),
        "AIRS prompt scan failed, proceeding unscanned",
      );
    });

    it("logs errorType when AISecSDKException is thrown on response scan", async () => {
      mockSyncScan
        .mockResolvedValueOnce(fullScanResponse)
        .mockRejectedValueOnce(
          new MockAISecSDKException("API error 429", "AISEC_CLIENT_SIDE_ERROR"),
        );

      const { processHandler: handler } = await import("../../src/app.js");
      const ctx = mockContext();
      await handler({ url: "https://example.com/recipe" }, ctx);

      expect(ctx.log.error).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: "AISEC_CLIENT_SIDE_ERROR",
          durationMs: expect.any(Number),
        }),
        "AIRS response scan failed, proceeding unscanned",
      );
    });

    it("proceeds unscanned when response scan throws", async () => {
      mockSyncScan
        .mockResolvedValueOnce(fullScanResponse)
        .mockRejectedValueOnce(new Error("AIRS timeout"));

      const { processHandler: handler } = await import("../../src/app.js");
      const ctx = mockContext();
      const result = await handler({ url: "https://example.com/recipe" }, ctx);

      expect(JSON.parse(result)).toEqual(validRecipe);
      expect(ctx.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.stringContaining("AIRS timeout") }),
        "AIRS response scan failed, proceeding unscanned",
      );
    });

    it("includes agent_meta in metadata when BEDROCK_AGENT_ID is set", async () => {
      vi.stubEnv("BEDROCK_AGENT_ID", "agent-123");
      vi.stubEnv("AWS_REGION", "us-east-1");
      vi.stubEnv("AWS_ACCOUNT_ID", "111222333");
      vi.stubEnv("BEDROCK_AGENT_VERSION", "3");

      const { processHandler: handler } = await import("../../src/app.js");
      await handler({ url: "https://example.com/recipe" }, mockContext());

      const call = mockSyncScan.mock.calls[0];
      expect(call[2].metadata.agent_meta).toEqual({
        agent_id: "agent-123",
        agent_version: "3",
        agent_arn: "arn:aws:bedrock:us-east-1:111222333:agent/agent-123",
      });
    });

    it("omits agent_arn when AWS_ACCOUNT_ID is not set", async () => {
      vi.stubEnv("BEDROCK_AGENT_ID", "agent-123");

      const { processHandler: handler } = await import("../../src/app.js");
      await handler({ url: "https://example.com/recipe" }, mockContext());

      const call = mockSyncScan.mock.calls[0];
      expect(call[2].metadata.agent_meta.agent_arn).toBeUndefined();
    });

    it("returns blocked response when response scan blocks", async () => {
      mockSyncScan.mockResolvedValueOnce(fullScanResponse).mockResolvedValueOnce({
        action: "block",
        category: "dlp",
        scan_id: "s-resp-blocked",
        report_id: "r2",
      });

      const { processHandler: handler } = await import("../../src/app.js");
      const result = await handler({ url: "https://example.com/recipe" }, mockContext());

      expect(JSON.parse(result)).toEqual({
        error: "blocked",
        message: "Response blocked by Prisma AIRS security.",
        category: "dlp",
        scan_id: "s-resp-blocked",
      });
    });
  });

  describe("prompt-based input (LiteLLM compatibility)", () => {
    it("extracts URL from prompt field", async () => {
      mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(validRecipe)));

      const result = await processHandler(
        { prompt: "Extract the recipe from https://example.com/recipe" },
        mockContext(),
      );

      expect(JSON.parse(result)).toEqual(validRecipe);
      expect(mockInvoke).toHaveBeenCalledWith(
        "Extract the recipe from this URL: https://example.com/recipe",
      );
    });

    it("prefers url field over prompt field", async () => {
      mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(validRecipe)));

      const result = await processHandler(
        { url: "https://example.com/a", prompt: "get https://example.com/b" },
        mockContext(),
      );

      expect(JSON.parse(result)).toEqual(validRecipe);
      expect(mockInvoke).toHaveBeenCalledWith(
        "Extract the recipe from this URL: https://example.com/a",
      );
    });

    it("returns error when prompt has no URL", async () => {
      const result = await processHandler({ prompt: "make me a recipe for pasta" }, mockContext());

      const parsed = JSON.parse(result);
      expect(parsed.error).toBe("bad_request");
      expect(parsed.message).toContain("No URL found");
    });

    it("returns error when neither url nor prompt provided", async () => {
      const result = await processHandler({}, mockContext());

      const parsed = JSON.parse(result);
      expect(parsed.error).toBe("bad_request");
      expect(parsed.message).toContain("No URL found");
    });
  });

  it("skips AIRS scans when disabled", async () => {
    mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(validRecipe)));

    await processHandler({ url: "https://example.com/recipe" }, mockContext());

    expect(mockSyncScan).not.toHaveBeenCalled();
  });
});
