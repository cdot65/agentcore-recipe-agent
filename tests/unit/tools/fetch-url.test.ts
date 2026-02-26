import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SDK tool() to pass through the callback for direct testing
vi.mock("@strands-agents/sdk", () => ({
  tool: vi.fn().mockImplementation((config) => ({
    ...config,
    invoke: async (input: unknown) => config.callback(input),
  })),
}));

import { fetchUrlTool } from "../../../src/tools/fetch-url.js";

function mockResponse(html: string, ok = true, status = 200, statusText = "OK"): Response {
  return {
    ok,
    status,
    statusText,
    text: () => Promise.resolve(html),
  } as unknown as Response;
}

function htmlPage(body: string, head = ""): string {
  return `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
}

function jsonLdScript(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

describe("fetchUrlTool", () => {
  const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  describe("text extraction", () => {
    it("extracts text from HTML body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("<p>Hello World</p>")));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.text).toBe("Hello World");
      expect(result.jsonLd).toBeNull();
    });

    it("collapses whitespace", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("<p>Hello   \n\n\t  World</p>")));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.text).toBe("Hello World");
    });

    it("returns empty string for empty body", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("")));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.text).toBe("");
    });

    it("truncates text longer than 30000 chars", async () => {
      const longText = "a".repeat(31000);
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage(`<p>${longText}</p>`)));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.text.length).toBe(30000 + "... [truncated]".length);
      expect(result.text).toContain("... [truncated]");
    });

    it("does not truncate text at exactly 30000 chars", async () => {
      const exactText = "a".repeat(30000);
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage(`<p>${exactText}</p>`)));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.text).toBe(exactText);
      expect(result.text).not.toContain("[truncated]");
    });
  });

  describe("element stripping", () => {
    const strippedTags = [
      "script",
      "style",
      "nav",
      "header",
      "footer",
      "aside",
      "noscript",
      "iframe",
    ];

    for (const tag of strippedTags) {
      it(`strips <${tag}> elements`, async () => {
        mockFetch.mockResolvedValueOnce(
          mockResponse(htmlPage(`<p>Keep</p> <${tag}>Remove</${tag}> <p>Also keep</p>`)),
        );
        const result = await fetchUrlTool.invoke({
          url: "https://example.com",
        });
        expect(result.text).toBe("Keep Also keep");
        expect(result.text).not.toContain("Remove");
      });
    }
  });

  describe("JSON-LD extraction", () => {
    it("extracts direct Recipe JSON-LD", async () => {
      const recipe = { "@type": "Recipe", name: "Pasta" };
      mockFetch.mockResolvedValueOnce(
        mockResponse(htmlPage("<p>Content</p>", jsonLdScript(recipe))),
      );
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(JSON.parse(result.jsonLd as string)).toEqual(recipe);
    });

    it("extracts Recipe from @graph array", async () => {
      const recipe = { "@type": "Recipe", name: "Pasta" };
      const graph = { "@graph": [{ "@type": "WebPage" }, recipe] };
      mockFetch.mockResolvedValueOnce(
        mockResponse(htmlPage("<p>Content</p>", jsonLdScript(graph))),
      );
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(JSON.parse(result.jsonLd as string)).toEqual(recipe);
    });

    it("extracts Recipe from top-level array", async () => {
      const recipe = { "@type": "Recipe", name: "Pasta" };
      const arr = [{ "@type": "WebPage" }, recipe];
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("<p>Content</p>", jsonLdScript(arr))));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(JSON.parse(result.jsonLd as string)).toEqual(recipe);
    });

    it("returns null when no JSON-LD scripts exist", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("<p>Content</p>")));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.jsonLd).toBeNull();
    });

    it("returns null when JSON-LD has no Recipe type", async () => {
      const data = { "@type": "Article", name: "Blog Post" };
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("<p>Content</p>", jsonLdScript(data))));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.jsonLd).toBeNull();
    });

    it("skips malformed JSON-LD", async () => {
      const head = '<script type="application/ld+json">not valid json</script>';
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("<p>Content</p>", head)));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.jsonLd).toBeNull();
    });

    it("skips empty JSON-LD script tag", async () => {
      const head = '<script type="application/ld+json"></script>';
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("<p>Content</p>", head)));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.jsonLd).toBeNull();
    });

    it("finds Recipe in second JSON-LD script", async () => {
      const article = { "@type": "Article" };
      const recipe = { "@type": "Recipe", name: "Pasta" };
      const head = jsonLdScript(article) + jsonLdScript(recipe);
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("<p>Content</p>", head)));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(JSON.parse(result.jsonLd as string)).toEqual(recipe);
    });

    it("extracts JSON-LD before stripping script tags", async () => {
      // JSON-LD is in a <script> tag which would be stripped — but extraction happens first
      const recipe = { "@type": "Recipe", name: "Pasta" };
      mockFetch.mockResolvedValueOnce(
        mockResponse(htmlPage("<p>Content</p>", jsonLdScript(recipe))),
      );
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.jsonLd).not.toBeNull();
      expect(result.text).not.toContain("Recipe");
    });

    it("returns null when @graph has no Recipe", async () => {
      const graph = { "@graph": [{ "@type": "WebPage" }, { "@type": "Person" }] };
      mockFetch.mockResolvedValueOnce(
        mockResponse(htmlPage("<p>Content</p>", jsonLdScript(graph))),
      );
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.jsonLd).toBeNull();
    });

    it("returns null when top-level array has no Recipe", async () => {
      const arr = [{ "@type": "WebPage" }, { "@type": "Person" }];
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("<p>Content</p>", jsonLdScript(arr))));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.jsonLd).toBeNull();
    });
  });

  describe("HTTP errors", () => {
    it("returns error for HTTP 404", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse("", false, 404, "Not Found"));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.text).toBe("Error: HTTP 404 Not Found");
      expect(result.jsonLd).toBeNull();
    });

    it("returns error for HTTP 500", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse("", false, 500, "Internal Server Error"));
      const result = await fetchUrlTool.invoke({ url: "https://example.com" });
      expect(result.text).toBe("Error: HTTP 500 Internal Server Error");
      expect(result.jsonLd).toBeNull();
    });
  });

  describe("fetch headers", () => {
    it("sends realistic browser headers", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(htmlPage("<p>OK</p>")));
      await fetchUrlTool.invoke({ url: "https://example.com" });

      expect(mockFetch).toHaveBeenCalledWith("https://example.com", {
        headers: {
          "User-Agent": expect.stringContaining("Mozilla/5.0"),
          Accept: expect.stringContaining("text/html"),
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });
    });
  });
});
