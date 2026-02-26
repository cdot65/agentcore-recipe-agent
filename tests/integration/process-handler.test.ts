import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
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
      { url: "https://example.com/recipe" },
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
});
