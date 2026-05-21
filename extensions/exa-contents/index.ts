/**
 * Exa Contents Tool
 *
 * Fetches full page content, highlights, and AI summaries from the Exa Contents API.
 *
 * API key: Set EXA_API_KEY in your environment or via pi's auth.
 *
 * Reference:
 *   https://exa.ai/docs/reference/contents-api-guide-for-coding-agents
 *   https://exa.ai/docs/reference/contents-best-practices
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExaTextOptions {
  maxCharacters?: number;
  /** If true, return raw HTML instead of cleaned markdown text. */
  includeHtml?: boolean;
}

interface ExaHighlightsOptions {
  query?: string;
  numHighlights?: number;
  maxCharacters?: number;
}

interface ExaSummaryOptions {
  query: string;
  schema?: Record<string, unknown>;
}

interface ExaContentsRequest {
  urls?: string[];
  ids?: string[];
  text?: boolean | ExaTextOptions;
  highlights?: boolean | ExaHighlightsOptions;
  summary?: ExaSummaryOptions;
  maxAgeHours?: number;
  livecrawlTimeout?: number;
  subpages?: number;
  subpageTarget?: string[];
}

interface ExaStatusEntry {
  id: string;
  status: "success" | "error";
  error?: {
    tag: string;
    httpStatusCode?: number;
  };
}

interface ExaContentsResult {
  id: string;
  url: string;
  title?: string;
  text?: string;
  highlights?: string[] | string;
  summary?: string | Record<string, unknown>;
  subpages?: ExaContentsResult[];
  publishedDate?: string;
  author?: string;
  score?: number;
  textLength?: number;
}

interface ExaContentsResponse {
  results: ExaContentsResult[];
  statuses: ExaStatusEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXA_API_BASE = "https://api.exa.ai";

function getApiKey(): string {
  // Check common environment variable names
  const key =
    process.env.EXA_API_KEY ||
    process.env.EXA_API_TOKEN ||
    process.env.EXA_KEY ||
    "";
  if (!key) {
    throw new Error(
      "EXA_API_KEY environment variable is not set. " +
        "Get a key at https://exa.ai and set EXA_API_KEY in your environment."
    );
  }
  return key;
}

/**
 * Format a result for the LLM, preferring highlights over full text when
 * both are available (highlights are ~10x more token-efficient).
 */
function formatResult(
  result: ExaContentsResult,
  requestedHighlights: boolean,
  requestedSummary: boolean,
  requestedHtml: boolean
): string {
  const parts: string[] = [];

  // Title & URL header
  if (result.title) {
    parts.push(`## ${result.title}`);
  }
  parts.push(`**URL:** ${result.url}`);
  if (result.publishedDate) {
    parts.push(`**Published:** ${result.publishedDate}`);
  }
  if (result.author) {
    parts.push(`**Author:** ${result.author}`);
  }
  parts.push("");

  // Highlights first (most token-efficient)
  if (requestedHighlights && result.highlights) {
    const hl =
      typeof result.highlights === "string"
        ? result.highlights
        : result.highlights.join("\n\n---\n\n");
    if (hl.trim()) {
      parts.push("### Highlights");
      parts.push("");
      parts.push(hl);
      parts.push("");
    }
  }

  // Summary
  if (requestedSummary && result.summary) {
    const summaryText =
      typeof result.summary === "string"
        ? result.summary
        : JSON.stringify(result.summary, null, 2);
    if (summaryText.trim()) {
      parts.push("### Summary");
      parts.push("");
      parts.push(summaryText);
      parts.push("");
    }
  }

  // Full text (always included by default unless only highlights/summary requested)
  if (result.text) {
    const label = requestedHtml ? "### HTML Content" : "### Content";
    parts.push(label);
    parts.push("");
    parts.push(result.text);
  }

  return parts.join("\n");
}

function formatSubpageResult(
  result: ExaContentsResult,
  index: number,
  requestedHighlights: boolean,
  requestedHtml: boolean
): string {
  const parts: string[] = [];
  parts.push(`#### Subpage ${index + 1}: ${result.title || result.url}`);
  parts.push(`**URL:** ${result.url}`);
  parts.push("");

  if (requestedHighlights && result.highlights) {
    const hl =
      typeof result.highlights === "string"
        ? result.highlights
        : result.highlights.join("\n\n---\n\n");
    if (hl.trim()) {
      parts.push("**Highlights:**");
      parts.push(hl);
      parts.push("");
    }
  }

  if (result.text) {
    parts.push(result.text);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "exa_contents",
    label: "Exa Contents",
    description:
      "Fetch clean, full-page content (as markdown), highlights, and/or AI-generated summaries " +
      "from URLs using the Exa Contents API. Returns clean markdown text by default. " +
      "Use this tool to retrieve and read the actual content of web pages.",
    promptSnippet:
      "Retrieve full page content, highlights, or summaries from URLs via Exa",
    promptGuidelines: [
      "Use exa_contents to read the actual content of web pages found via search. Pass result URLs directly.",
      "exa_contents returns clean markdown text by default. Set text.includeHtml to true only if the user explicitly asks for raw HTML.",
      "Prefer highlights (set highlights: true) for token efficiency — they are ~10x smaller than full text. If highlights are insufficient, make a second call with highlights disabled.",
      "Always check the returned statuses — the API returns 200 even when individual URLs fail.",
      "Use subpages and subpageTarget to crawl documentation or multi-page sites in one call.",
    ],

    parameters: Type.Object({
      urls: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Array of URLs to fetch content for. Use ids as an alternative.",
        })
      ),
      ids: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Array of Exa document IDs (or URLs) to fetch content for. Interchangeable with urls.",
        })
      ),

      // --- Text / content options ---
      text: Type.Optional(
        Type.Union([
          Type.Boolean({
            description:
              "Return full page content as clean markdown text (default: true).",
          }),
          Type.Object(
            {
              maxCharacters: Type.Optional(
                Type.Number({
                  description:
                    "Maximum characters to return for each page's text content.",
                })
              ),
              includeHtml: Type.Optional(
                Type.Boolean({
                  description:
                    "If true, return raw HTML instead of cleaned markdown. Only set this when the user explicitly asks for HTML.",
                  default: false,
                })
              ),
            },
            { description: "Options for text content retrieval." }
          ),
        ]),
        { description: "Return page text. True (default) or options object." }
      ),

      // --- Highlights ---
      highlights: Type.Optional(
        Type.Union([
          Type.Boolean({
            description:
              "Return relevant highlights/snippets from the page. True uses document's own content selection.",
          }),
          Type.Object(
            {
              query: Type.Optional(
                Type.String({
                  description:
                    "A natural-language query to focus highlights on specific topics.",
                })
              ),
              numHighlights: Type.Optional(
                Type.Number({
                  description:
                    "Maximum number of highlight snippets to return per page.",
                })
              ),
              maxCharacters: Type.Optional(
                Type.Number({
                  description:
                    "Maximum characters to return across all highlights per page.",
                })
              ),
            },
            {
              description:
                "Options for highlights. Use query to focus on specific topics.",
            }
          ),
        ]),
        {
          description:
            "Return relevant excerpts/highlights. Token-efficient (~10x smaller than full text).",
        }
      ),

      // --- Summary ---
      summary: Type.Optional(
        Type.Object(
          {
            query: Type.String({
              description:
                "A natural-language query describing what to summarize. E.g., 'What is this page about?'",
            }),
            schema: Type.Optional(
              Type.Record(Type.String(), Type.Unknown(), {
                description:
                  "Optional JSON Schema to enforce structured output on the summary.",
              })
            ),
          },
          { description: "AI-generated summary of the page content." }
        )
      ),

      // --- Freshness ---
      maxAgeHours: Type.Optional(
        Type.Number({
          description:
            "Maximum age of cached content in hours before live-crawling. Default: 24. " +
            "0 = always livecrawl (real-time). -1 = cache only (never livecrawl). " +
            "Omit for Exa's default balanced behavior.",
          default: 24,
        })
      ),

      livecrawlTimeout: Type.Optional(
        Type.Number({
          description:
            "Timeout in milliseconds for live-crawling. Default: 10000. Increase to 12000-15000 for slow sites.",
        })
      ),

      // --- Subpage crawling ---
      subpages: Type.Optional(
        Type.Number({
          description:
            "Maximum number of subpages to crawl per URL. Start with 5-10 and increase if needed.",
        })
      ),

      subpageTarget: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Keywords to prioritize when selecting which subpages to crawl. E.g., ['api', 'docs', 'reference'].",
        })
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const apiKey = getApiKey();

      // Determine what content modes are requested
      const hasUrls = params.urls && params.urls.length > 0;
      const hasIds = params.ids && params.ids.length > 0;
      if (!hasUrls && !hasIds) {
        return {
          content: [
            {
              type: "text",
              text: "Error: You must provide at least one URL via `urls` or `ids`.",
            },
          ],
          details: { error: "missing_urls" },
          isError: true,
        };
      }

      // --- Build request body ---
      const body: ExaContentsRequest = {};

      if (params.urls && params.urls.length > 0) {
        body.urls = params.urls;
      }
      if (params.ids && params.ids.length > 0) {
        body.ids = params.ids;
      }

      // Text: default to true (return clean markdown)
      if (params.text !== undefined) {
        body.text = params.text;
      } else {
        body.text = true;
      }

      // Highlights
      if (params.highlights !== undefined) {
        body.highlights = params.highlights;
      }

      // Summary
      if (params.summary) {
        body.summary = params.summary;
      }

      // Freshness: default maxAgeHours to 24
      if (params.maxAgeHours !== undefined) {
        body.maxAgeHours = params.maxAgeHours;
      } else {
        body.maxAgeHours = 24;
      }

      if (params.livecrawlTimeout !== undefined) {
        body.livecrawlTimeout = params.livecrawlTimeout;
      }

      // Subpage crawling
      if (params.subpages !== undefined) {
        body.subpages = params.subpages;
      }
      if (params.subpageTarget && params.subpageTarget.length > 0) {
        body.subpageTarget = params.subpageTarget;
      }

      // --- Make the request ---
      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Fetching content from ${body.urls?.length || body.ids?.length || 0} URL(s)...`,
          },
        ],
      });

      let response: Response;
      try {
        response = await fetch(`${EXA_API_BASE}/contents`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: signal ?? undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Exa Contents API request failed: ${message}`,
            },
          ],
          details: { error: "fetch_failed", message },
          isError: true,
        };
      }

      if (!response.ok) {
        let errorDetail = "";
        try {
          const errorBody = await response.text();
          errorDetail = errorBody.slice(0, 500);
        } catch {
          // ignore
        }
        return {
          content: [
            {
              type: "text",
              text:
                `Exa Contents API returned HTTP ${response.status} ${response.statusText}.\n` +
                `Details: ${errorDetail || "(no body)"}`,
            },
          ],
          details: {
            error: "api_error",
            status: response.status,
            statusText: response.statusText,
            body: errorDetail,
          },
          isError: true,
        };
      }

      let data: ExaContentsResponse;
      try {
        data = (await response.json()) as ExaContentsResponse;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Failed to parse Exa Contents API response: ${message}`,
            },
          ],
          details: { error: "parse_failed", message },
          isError: true,
        };
      }

      // --- Process statuses (per-URL error handling) ---
      const failedUrls: string[] = [];
      if (data.statuses) {
        for (const status of data.statuses) {
          if (status.status === "error") {
            const tag = status.error?.tag || "UNKNOWN";
            const code = status.error?.httpStatusCode
              ? ` (HTTP ${status.error.httpStatusCode})`
              : "";
            failedUrls.push(`- ${status.id}: ${tag}${code}`);
          }
        }
      }

      // --- Build result text ---
      const requestedHighlights = params.highlights !== undefined;
      const requestedSummary = params.summary !== undefined;
      const requestedHtml =
        typeof params.text === "object" && params.text.includeHtml === true;

      const outputParts: string[] = [];

      // Failed URLs section
      if (failedUrls.length > 0) {
        outputParts.push("### ⚠️ Failed URLs");
        outputParts.push("");
        outputParts.push(...failedUrls);
        outputParts.push("");
      }

      // Results
      if (!data.results || data.results.length === 0) {
        if (failedUrls.length === 0) {
          outputParts.push("No results returned from Exa Contents API.");
        }
      } else {
        outputParts.push(
          `### Results (${data.results.length} page${data.results.length !== 1 ? "s" : ""})`
        );
        outputParts.push("");

        for (const result of data.results) {
          outputParts.push(
            formatResult(
              result,
              requestedHighlights,
              requestedSummary,
              requestedHtml
            )
          );
          outputParts.push("---");
          outputParts.push("");

          // Subpages
          if (result.subpages && result.subpages.length > 0) {
            outputParts.push(
              `**Subpages (${result.subpages.length}):**`
            );
            outputParts.push("");
            for (let i = 0; i < result.subpages.length; i++) {
              outputParts.push(
                formatSubpageResult(
                  result.subpages[i],
                  i,
                  requestedHighlights,
                  requestedHtml
                )
              );
              outputParts.push("");
            }
            outputParts.push("---");
            outputParts.push("");
          }
        }
      }

      const outputText = outputParts.join("\n");

      return {
        content: [{ type: "text", text: outputText }],
        details: {
          urls_requested: body.urls?.length || body.ids?.length || 0,
          results_count: data.results?.length || 0,
          failed_count: failedUrls.length,
          modes_used: {
            text: body.text !== undefined,
            highlights: body.highlights !== undefined,
            summary: body.summary !== undefined,
          },
          statuses: data.statuses,
        },
      };
    },
  });
}
