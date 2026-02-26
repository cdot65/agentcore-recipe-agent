import { tool } from "@strands-agents/sdk";
import { parseHTML } from "linkedom";
import { z } from "zod";

const STRIP_SELECTORS = [
  "script",
  "style",
  "nav",
  "header",
  "footer",
  "aside",
  "noscript",
  "iframe",
];
const MAX_TEXT_LENGTH = 30_000;

export const fetchUrlTool = tool({
  name: "fetch_url",
  description:
    "Fetches a URL and returns the page text content plus any schema.org/Recipe JSON-LD data found. Use this to retrieve recipe webpages.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch"),
  }),
  callback: async (input) => {
    const response = await fetch(input.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return { text: `Error: HTTP ${response.status} ${response.statusText}`, jsonLd: null };
    }

    const html = await response.text();
    const { document } = parseHTML(html);

    // Extract JSON-LD recipe data before stripping scripts
    let jsonLd: unknown = null;
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      try {
        const data = JSON.parse(script.textContent || "");
        // Handle both direct Recipe and @graph arrays
        if (data?.["@type"] === "Recipe") {
          jsonLd = data;
          break;
        }
        if (Array.isArray(data?.["@graph"])) {
          const recipe = data["@graph"].find(
            (item: Record<string, unknown>) => item?.["@type"] === "Recipe",
          );
          if (recipe) {
            jsonLd = recipe;
            break;
          }
        }
        // Handle array of objects at top level
        if (Array.isArray(data)) {
          const recipe = data.find((item: Record<string, unknown>) => item?.["@type"] === "Recipe");
          if (recipe) {
            jsonLd = recipe;
            break;
          }
        }
      } catch {
        // skip malformed JSON-LD
      }
    }

    // Strip non-content elements
    for (const selector of STRIP_SELECTORS) {
      for (const el of document.querySelectorAll(selector)) {
        el.remove();
      }
    }

    // Extract text, collapse whitespace, truncate
    let text = (document.body?.textContent || "").replace(/\s+/g, " ").trim();

    if (text.length > MAX_TEXT_LENGTH) {
      text = `${text.slice(0, MAX_TEXT_LENGTH)}... [truncated]`;
    }

    return {
      text,
      jsonLd: jsonLd ? JSON.stringify(jsonLd) : null,
    };
  },
});
