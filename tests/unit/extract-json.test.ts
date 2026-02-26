import { describe, expect, it } from "vitest";

// Must mock SDK modules before importing app.ts to prevent side effects
vi.mock("@strands-agents/sdk", () => ({
  Agent: class {
    invoke = vi.fn();
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

import { extractJson } from "../../src/app.js";

describe("extractJson", () => {
  describe("tier 1: direct JSON.parse", () => {
    it("parses valid JSON object", () => {
      expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    });

    it("parses valid JSON array", () => {
      expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
    });

    it("parses JSON string", () => {
      expect(extractJson('"hello"')).toBe("hello");
    });

    it("parses JSON number", () => {
      expect(extractJson("42")).toBe(42);
    });
  });

  describe("tier 2: markdown code block", () => {
    it("extracts from ```json block", () => {
      const input = '```json\n{"a":1}\n```';
      expect(extractJson(input)).toEqual({ a: 1 });
    });

    it("extracts from ``` block (no language)", () => {
      const input = '```\n{"a":1}\n```';
      expect(extractJson(input)).toEqual({ a: 1 });
    });

    it("extracts with surrounding text", () => {
      const input = 'Here is the recipe:\n```json\n{"a":1}\n```\nDone.';
      expect(extractJson(input)).toEqual({ a: 1 });
    });
  });

  describe("tier 3: brace extraction", () => {
    it("extracts JSON from surrounding text", () => {
      const input = 'Here is the recipe: {"a":1} hope that helps';
      expect(extractJson(input)).toEqual({ a: 1 });
    });

    it("handles nested braces", () => {
      const input = 'text {"a":{"b":1}} text';
      expect(extractJson(input)).toEqual({ a: { b: 1 } });
    });
  });

  describe("failure cases", () => {
    it("throws on plain text", () => {
      expect(() => extractJson("hello world")).toThrow(
        "Could not extract JSON from agent response",
      );
    });

    it("throws on empty string", () => {
      expect(() => extractJson("")).toThrow("Could not extract JSON from agent response");
    });

    it("throws on invalid JSON in braces", () => {
      expect(() => extractJson("{not json}")).toThrow("Could not extract JSON from agent response");
    });

    it("throws when code block contains invalid JSON", () => {
      const input = "```json\n{broken\n```";
      // Falls through tier 2, then tier 3 finds braces but they're invalid
      expect(() => extractJson(input)).toThrow("Could not extract JSON from agent response");
    });
  });

  describe("tier priority", () => {
    it("tier 1 wins over tier 3 for direct JSON", () => {
      // This is valid JSON directly, so tier 1 handles it
      const input = '{"a":1}';
      expect(extractJson(input)).toEqual({ a: 1 });
    });
  });
});
