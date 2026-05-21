/**
 * Exa Search Tool for Pi
 *
 * Registers an `exa_search` tool that queries the Exa Search API.
 * Uses highlights-first strategy: tries highlights for token efficiency,
 * falls back to full text if highlights are insufficient.
 *
 * Requires EXA_API_KEY environment variable.
 *
 * Search methods: auto (default), fast, instant, deep-lite, deep, deep-reasoning
 *
 * Usage:
 *   pi -e ./exa-search.ts
 *
 * Or place in ~/.pi/agent/extensions/ for auto-discovery.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, StringEnum } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";
const DEFAULT_MAX_AGE_HOURS = 24;
const DEFAULT_NUM_RESULTS = 10;
const DEFAULT_TYPE = "auto";
const HIGHLIGHTS_MIN_TOTAL_CHARS = 500; // Threshold: if total highlights < this, fall back to full text
const FALLBACK_TEXT_MAX_CHARS = 10000; // Max chars for full-text fallback

// Search types supported by Exa
const SEARCH_TYPES = [
  "auto",
  "fast",
  "instant",
  "deep-lite",
  "deep",
  "deep-reasoning",
] as const;

const CONTENT_CATEGORIES = [
  "company",
  "people",
  "research paper",
  "news",
  "personal site",
  "financial report",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ExaSearchResult {
  title: string;
  url: string;
  id: string;
  publishedDate?: string | null;
  author?: string | null;
  image?: string;
  favicon?: string;
  text?: string;
  highlights?: string[];
  highlightScores?: number[];
  summary?: string;
}

interface ExaSearchResponse {
  requestId: string;
  searchType: string;
  results: ExaSearchResult[];
  costDollars?: { total: number };
}

/** Return true when highlights across results look too sparse for a useful answer. */
function highlightsTooThin(results: ExaSearchResult[]): boolean {
  let totalChars = 0;
  let resultsWithHighlights = 0;

  for (const r of results) {
    if (r.highlights && r.highlights.length > 0) {
      resultsWithHighlights++;
      for (const h of r.highlights) {
        totalChars += h.length;
      }
    }
  }

  // No highlights at all → definitely too thin
  if (resultsWithHighlights === 0) return true;

  // Majority of results have no highlights → probably too thin
  if (resultsWithHighlights < results.length / 2) return true;

  // Total highlight text is very short → too thin
  if (totalChars < HIGHLIGHTS_MIN_TOTAL_CHARS) return true;

  return false;
}

/** Build the Exa search request body. */
function buildRequestBody(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>,
  useFullText: boolean,
) {
  const contents: Record<string, unknown> = {
    maxAgeHours: params.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS,
  };

  if (useFullText) {
    contents.text = { maxCharacters: FALLBACK_TEXT_MAX_CHARS };
  } else {
    contents.highlights = true;
  }

  if (params.livecrawlTimeout != null) {
    contents.livecrawlTimeout = params.livecrawlTimeout;
  }
  if (params.subpages != null) {
    contents.subpages = params.subpages;
  }
  if (params.subpageTarget) {
    contents.subpageTarget = params.subpageTarget;
  }

  const body: Record<string, unknown> = {
    query: params.query,
    type: params.type ?? DEFAULT_TYPE,
    numResults: params.numResults ?? DEFAULT_NUM_RESULTS,
    contents,
  };

  if (params.category) body.category = params.category;
  if (params.includeDomains?.length) body.includeDomains = params.includeDomains;
  if (params.excludeDomains?.length) body.excludeDomains = params.excludeDomains;
  if (params.startPublishedDate) body.startPublishedDate = params.startPublishedDate;
  if (params.endPublishedDate) body.endPublishedDate = params.endPublishedDate;

  return body;
}

/** Execute a single search call against the Exa API. */
async function searchExa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>,
  useFullText: boolean,
  signal?: AbortSignal,
): Promise<ExaSearchResponse> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "EXA_API_KEY environment variable is not set. Get a key at https://dashboard.exa.ai/api-keys",
    );
  }

  const body = buildRequestBody(params, useFullText);

  const response = await fetch(EXA_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errBody = await response.json();
      errorDetail = (errBody as { error?: string }).error ?? "";
    } catch {
      // ignore parse errors for error body
    }
    const hint: Record<number, string> = {
      400: "Bad request — check parameters or unsupported filter for category.",
      401: "Invalid or missing EXA_API_KEY.",
      422: "Validation error — check parameter types and constraints.",
      429: "Rate limit exceeded — wait and retry.",
      500: "Exa internal server error.",
    };
    throw new Error(
      `Exa API error ${response.status}: ${hint[response.status] ?? "Unexpected error"}${errorDetail ? ` (${errorDetail})` : ""}`,
    );
  }

  return (await response.json()) as ExaSearchResponse;
}

/** Format a single search result as markdown. */
function formatResult(r: ExaSearchResult, index: number): string {
  const lines: string[] = [];
  lines.push(`### ${index + 1}. [${r.title}](${r.url})`);
  if (r.publishedDate) {
    lines.push(`**Published:** ${r.publishedDate}`);
  }
  if (r.author) {
    lines.push(`**Author:** ${r.author}`);
  }

  if (r.highlights && r.highlights.length > 0) {
    lines.push("");
    for (const h of r.highlights) {
      lines.push(`> ${h}`);
    }
  }

  if (r.text) {
    lines.push("");
    lines.push(r.text);
  }

  lines.push("");
  return lines.join("\n");
}

/** Format the full response for the LLM. */
function formatResponse(
  highlightsResp: ExaSearchResponse,
  fullTextResp: ExaSearchResponse | null,
  params: { query: string; type: string },
): string {
  const lines: string[] = [];
  const usedFullText = fullTextResp !== null;
  const primary = usedFullText ? fullTextResp : highlightsResp;

  lines.push(`**Exa search results for:** "${params.query}"`);
  lines.push(`**Search type:** ${primary.searchType}`);
  if (primary.costDollars?.total != null) {
    lines.push(`**Cost:** $${primary.costDollars.total.toFixed(4)}`);
  }
  if (usedFullText) {
    lines.push(
      `**Note:** Highlights were too sparse — fell back to full-text content for better coverage.`,
    );
  }
  lines.push(`**Results:** ${primary.results.length}`);
  lines.push("");

  // Merge results: if we have both, use full-text results (which have text),
  // supplementing with highlight metadata where useful.
  if (usedFullText && fullTextResp) {
    for (let i = 0; i < fullTextResp.results.length; i++) {
      const r = fullTextResp.results[i];
      lines.push(formatResult(r, i));
    }
  } else {
    for (let i = 0; i < highlightsResp.results.length; i++) {
      const r = highlightsResp.results[i];
      lines.push(formatResult(r, i));
    }
  }

  lines.push("---");
  lines.push(
    `Use \`exa_search\` with \`maxAgeHours: 0\` to force live-crawling for real-time information.`,
  );
  lines.push(
    `Use \`exa_contents\` to fetch the full page content for any result URL above.`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool parameters schema
// ---------------------------------------------------------------------------

const ExaSearchParams = Type.Object({
  query: Type.String({ description: "Natural language search query. Supports long, semantically rich descriptions." }),
  type: Type.Optional(
    StringEnum(SEARCH_TYPES, {
      description:
        'Search method: "auto" (default, balance speed/quality), "fast" (low latency), "instant" (lowest latency), "deep-lite" (lightweight synthesis), "deep" (multi-step research), "deep-reasoning" (max reasoning).',
    }),
  ),
  numResults: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-100). Default: 10.",
      minimum: 1,
      maximum: 100,
    }),
  ),
  category: Type.Optional(
    StringEnum(CONTENT_CATEGORIES, {
      description:
        "Focus on specific content type: company, people, research paper, news, personal site, or financial report.",
    }),
  ),
  includeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Only return results from these domains (max 1200).",
    }),
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude results from these domains (max 1200).",
    }),
  ),
  startPublishedDate: Type.Optional(
    Type.String({
      description: "ISO 8601 date. Only return links published after this date (e.g., 2025-01-01).",
    }),
  ),
  endPublishedDate: Type.Optional(
    Type.String({
      description: "ISO 8601 date. Only return links published before this date.",
    }),
  ),
  maxAgeHours: Type.Optional(
    Type.Number({
      description:
        "Maximum age of cached content in hours. 0 = always livecrawl, -1 = never livecrawl. Default: 24.",
    }),
  ),
  livecrawlTimeout: Type.Optional(
    Type.Number({
      description: "Timeout for livecrawling in milliseconds. Default: 10000.",
    }),
  ),
  subpages: Type.Optional(
    Type.Number({
      description: "Number of subpages to crawl per result (start with 5-10). Default: 0.",
      minimum: 0,
    }),
  ),
  subpageTarget: Type.Optional(
    Type.Array(Type.String(), {
      description: "Keywords to prioritize when selecting subpages (e.g., ['api', 'docs']).",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function exaSearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "exa_search",
    label: "Exa Search",
    description:
      "Search the web using Exa's semantic search API. Returns highlights by default for token efficiency. If highlights are too sparse, automatically falls back to full-text content. Use for finding documentation, current information, research papers, company info, news, and more.",
    promptSnippet:
      "Search the web with Exa (semantic search).",
    promptGuidelines: [
      "Use exa_search for web searches, current information, documentation lookups, research, or finding specific pages. Prefer it over web scraping for discovering URLs.",
    ],
    parameters: ExaSearchParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      // Honour abort signals (e.g., user pressed Escape)
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Search cancelled." }] };
      }

      const typedParams = params as Record<string, unknown>;

      // ---- Phase 1: search with highlights ----
      const highlightsResp = await searchExa(typedParams, false, signal);

      // ---- Phase 2: if highlights are too thin, fall back to full text ----
      let fullTextResp: ExaSearchResponse | null = null;

      if (highlightsTooThin(highlightsResp.results)) {
        try {
          fullTextResp = await searchExa(typedParams, true, signal);
        } catch (err) {
          // If the fallback fails, just use highlights — don't fail the whole request
          const message = err instanceof Error ? err.message : String(err);
          fullTextResp = null;
          // We'll note the fallback failure in the output
          return {
            content: [
              {
                type: "text",
                text: formatResponse(highlightsResp, null, {
                  query: String(typedParams.query ?? ""),
                  type: String(typedParams.type ?? DEFAULT_TYPE),
                }) +
                  `\n\n⚠️ Full-text fallback failed: ${message}\nResults above are highlights-only.`,
              },
            ],
            details: {
              highlightsResponse: highlightsResp,
              fullTextFallbackError: message,
            },
          };
        }
      }

      const output = formatResponse(highlightsResp, fullTextResp, {
        query: String(typedParams.query ?? ""),
        type: String(typedParams.type ?? DEFAULT_TYPE),
      });

      return {
        content: [{ type: "text", text: output }],
        details: {
          highlightsResponse: highlightsResp,
          fullTextResponse: fullTextResp,
          usedFullTextFallback: fullTextResp !== null,
        },
      };
    },
  });
}
