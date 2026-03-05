import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockScanPrompt, mockScanResponse, mockIsEnabled } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockScanPrompt: vi.fn(),
  mockScanResponse: vi.fn(),
  mockIsEnabled: vi.fn().mockReturnValue(false),
}));

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

vi.mock("../../src/lib/airs-api-client.js", () => ({
  PrismaAIRSClient: class {
    isEnabled = mockIsEnabled;
    scanPrompt = mockScanPrompt;
    scanResponse = mockScanResponse;
  },
}));

import { processHandler } from "../../src/app.js";

const validRecipe = {
  title: "Test Pasta",
  ingredients: [{ quantity: 2, unit: "cups", name: "flour", description: "" }],
  preparationSteps: ["Mix dough"],
  cookingSteps: ["Boil for 10 min"],
  notes: { servings: "4" },
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
    mockScanPrompt.mockReset();
    mockScanResponse.mockReset();
    mockIsEnabled.mockReturnValue(false);
  });

  it("returns validated recipe from direct JSON response", async () => {
    mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(validRecipe)));

    const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

    expect(result).toEqual(validRecipe);
  });

  it("handles markdown-wrapped JSON response", async () => {
    mockInvoke.mockResolvedValueOnce(
      mockAgentResult(`\`\`\`json\n${JSON.stringify(validRecipe)}\n\`\`\``),
    );

    const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

    expect(result).toEqual(validRecipe);
  });

  it("handles JSON with surrounding text", async () => {
    mockInvoke.mockResolvedValueOnce(
      mockAgentResult(`Here is the recipe: ${JSON.stringify(validRecipe)} enjoy!`),
    );

    const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

    expect(result).toEqual(validRecipe);
  });

  it("throws and logs when agent invocation fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Model timeout"));

    const ctx = mockContext();
    await expect(processHandler({ url: "https://example.com/recipe" }, ctx)).rejects.toThrow(
      "Model timeout",
    );

    expect(ctx.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Error: Model timeout" }),
      "Agent invocation failed",
    );
  });

  it("throws when agent returns no JSON", async () => {
    mockInvoke.mockResolvedValueOnce(mockAgentResult("I could not find a recipe on that page."));

    await expect(
      processHandler({ url: "https://example.com/recipe" }, mockContext()),
    ).rejects.toThrow("Could not extract JSON from agent response");
  });

  it("throws when JSON fails schema validation", async () => {
    const invalid = { title: "Missing fields" }; // no ingredients, etc.
    mockInvoke.mockResolvedValueOnce(mockAgentResult(JSON.stringify(invalid)));

    await expect(
      processHandler({ url: "https://example.com/recipe" }, mockContext()),
    ).rejects.toThrow();
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

    expect(result).toEqual(fullRecipe);
  });

  describe("AIRS integration", () => {
    beforeEach(() => {
      mockIsEnabled.mockReturnValue(true);
      mockScanPrompt.mockResolvedValue({ action: "allow", scan_id: "s1" });
      mockScanResponse.mockResolvedValue({ action: "allow", scan_id: "s2" });
      mockInvoke.mockResolvedValue(mockAgentResult(JSON.stringify(validRecipe)));
    });

    it("calls scanPrompt and scanResponse when enabled", async () => {
      await processHandler({ url: "https://example.com/recipe" }, mockContext());

      expect(mockScanPrompt).toHaveBeenCalledOnce();
      expect(mockScanResponse).toHaveBeenCalledOnce();
    });

    it("returns blocked response when prompt scan blocks", async () => {
      mockScanPrompt.mockResolvedValueOnce({
        action: "block",
        category: "injection",
        scan_id: "s-blocked",
      });

      const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

      expect(result).toEqual({
        error: "blocked",
        message: "Request blocked by Prisma AIRS security.",
        category: "injection",
        scan_id: "s-blocked",
      });
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("returns blocked response when response scan blocks", async () => {
      mockScanResponse.mockResolvedValueOnce({
        action: "block",
        category: "dlp",
        scan_id: "s-resp-blocked",
      });

      const result = await processHandler({ url: "https://example.com/recipe" }, mockContext());

      expect(result).toEqual({
        error: "blocked",
        message: "Response blocked by Prisma AIRS security.",
        category: "dlp",
        scan_id: "s-resp-blocked",
      });
    });

    it("skips AIRS scans when disabled", async () => {
      mockIsEnabled.mockReturnValue(false);

      await processHandler({ url: "https://example.com/recipe" }, mockContext());

      expect(mockScanPrompt).not.toHaveBeenCalled();
      expect(mockScanResponse).not.toHaveBeenCalled();
    });
  });
});
