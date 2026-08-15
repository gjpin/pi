import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import exaContentsExtension, {
  buildRequestBody,
  DEFAULT_FALLBACK_MIN_CHARACTERS,
  formatHighlights,
  formatResult,
  formatStatus,
  formatSummary,
  limitOutput,
  MAX_OUTPUT_BYTES,
} from "./index.ts";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  details?: Record<string, unknown>;
};

type RegisteredTool = {
  execute: (...args: unknown[]) => Promise<ToolResult>;
};

const envKeys = ["EXA_API_KEY", "EXA_API_TOKEN", "EXA_KEY"] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
});

function registerTool(): RegisteredTool {
  let registered: RegisteredTool | undefined;
  const pi = {
    registerTool(definition: unknown) {
      registered = definition as RegisteredTool;
    },
  } as unknown as ExtensionAPI;

  exaContentsExtension(pi);
  assert.ok(registered, "the extension should register a tool");
  return registered;
}

function responseFrom(data: unknown, status = 200, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
    json: async () => data,
  } as Response;
}

function setFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = handler as typeof fetch;
}

function textFrom(result: ToolResult): string {
  return result.content.find((part) => part.type === "text")?.text ?? "";
}

describe("buildRequestBody", () => {
  it("defaults to full text for known URLs", () => {
    assert.deepEqual(buildRequestBody({ urls: ["https://example.com"] }), {
      urls: ["https://example.com"],
      text: true,
    });
  });

  it("does not implicitly request full text with highlights or summary", () => {
    assert.deepEqual(
      buildRequestBody({
        ids: ["doc-123"],
        highlights: { query: "the important part" },
      }),
      {
        ids: ["doc-123"],
        highlights: { query: "the important part" },
      }
    );

    assert.deepEqual(
      buildRequestBody({
        urls: ["https://example.com"],
        summary: { query: "What is this page about?" },
      }),
      {
        urls: ["https://example.com"],
        summary: { query: "What is this page about?" },
      }
    );
  });

  it("preserves explicit modes and request options", () => {
    assert.deepEqual(
      buildRequestBody({
        urls: ["https://example.com"],
        text: { includeHtmlTags: true, verbosity: "compact" },
        highlights: true,
        summary: { query: "Extract the answer", schema: { type: "object" } },
        extras: { links: 5, imageLinks: 2 },
        compliance: "hipaa",
        maxAgeHours: 0,
        livecrawlTimeout: 15_000,
        subpages: 3,
        subpageTarget: ["guide", "reference"],
      }),
      {
        urls: ["https://example.com"],
        text: { includeHtmlTags: true, verbosity: "compact" },
        highlights: true,
        summary: { query: "Extract the answer", schema: { type: "object" } },
        extras: { links: 5, imageLinks: 2 },
        compliance: "hipaa",
        maxAgeHours: 0,
        livecrawlTimeout: 15_000,
        subpages: 3,
        subpageTarget: ["guide", "reference"],
      }
    );
  });

  it("requires exactly one non-empty source array", () => {
    assert.throws(
      () => buildRequestBody({}),
      /Provide exactly one non-empty `urls` or `ids` array/
    );
    assert.throws(
      () => buildRequestBody({ urls: [] }),
      /Provide exactly one non-empty `urls` or `ids` array/
    );
    assert.throws(
      () =>
        buildRequestBody({
          urls: ["https://example.com"],
          ids: ["doc-123"],
        }),
      /Provide exactly one non-empty `urls` or `ids` array/
    );
  });

  it("requires at least one enabled content mode", () => {
    assert.throws(
      () => buildRequestBody({ urls: ["https://example.com"], text: false }),
      /At least one content mode must be enabled/
    );
    assert.throws(
      () =>
        buildRequestBody({
          urls: ["https://example.com"],
          highlights: false,
        }),
      /At least one content mode must be enabled/
    );
  });
});

describe("formatting", () => {
  it("formats summary and highlights in their supported shapes", () => {
    assert.equal(formatSummary("plain summary"), "plain summary");
    assert.equal(formatSummary({ answer: "42" }), '{\n  "answer": "42"\n}');
    assert.equal(formatHighlights("one highlight"), "one highlight");
    assert.equal(formatHighlights(["one", "two"]), "one\n\n---\n\ntwo");
  });

  it("renders requested result fields, metadata, and extras", () => {
    const output = formatResult(
      {
        id: "doc-123",
        url: "https://example.com/article",
        title: "An article",
        publishedDate: "2026-01-02",
        author: "A. Writer",
        favicon: "https://example.com/favicon.ico",
        image: "https://example.com/image.png",
        score: 0.88,
        textLength: 1234,
        highlights: ["First", "Second"],
        highlightScores: [0.9, 0.5],
        summary: { answer: "A structured answer" },
        text: "<p>Article text</p>",
        extras: {
          links: ["https://example.com/related"],
          imageLinks: ["https://example.com/related.png"],
          richLinks: [{ url: "https://example.com/rich", title: "Related" }],
          richImageLinks: [{ url: "https://example.com/rich.png" }],
          codeBlocks: [{ language: "ts" }],
          custom: { source: "test" },
        },
      },
      true,
      true,
      true,
      true
    );

    assert.match(output, /<external_web_content>/);
    assert.match(output, /## An article/);
    assert.match(output, /\*\*URL:\*\* https:\/\/example\.com\/article/);
    assert.match(output, /\*\*ID:\*\* doc-123/);
    assert.match(output, /\*\*Score:\*\* 0\.88/);
    assert.match(output, /\*\*Text length:\*\* 1234/);
    assert.match(output, /### Highlights/);
    assert.match(output, /First\n\n---\n\nSecond/);
    assert.match(output, /### Summary/);
    assert.match(output, /A structured answer/);
    assert.match(output, /### Content \(HTML tags preserved\)/);
    assert.match(output, /### Extracted links/);
    assert.match(output, /### Extracted image links/);
    assert.match(output, /### Rich links/);
    assert.match(output, /https:\/\/example\.com\/rich/);
    assert.match(output, /### Rich image links/);
    assert.match(output, /### Code blocks/);
    assert.match(output, /### Other extras/);
    assert.match(output, /<\/external_web_content>/);
  });

  it("omits content modes that were not requested", () => {
    const output = formatResult(
      {
        url: "https://example.com",
        highlights: ["highlight"],
        summary: "summary",
        text: "full text",
      },
      false,
      true,
      false,
      false
    );

    assert.match(output, /highlight/);
    assert.doesNotMatch(output, /### Summary/);
    assert.doesNotMatch(output, /### Content/);
  });

  it("renders fallback text only when marked as recovered content", () => {
    const output = formatResult(
      {
        url: "https://example.com",
        highlights: [],
        text: "Recovered full text",
      },
      false,
      true,
      false,
      false,
      "##",
      true
    );

    assert.match(output, /### Fallback full text/);
    assert.match(output, /Recovered full text/);
  });

  it("formats success and error statuses", () => {
    assert.equal(formatStatus({ id: "doc-1", status: "success" }), "- doc-1: success");
    assert.equal(
      formatStatus({
        id: "doc-2",
        status: "success",
        source: "cached",
      }),
      "- doc-2: success (cached)"
    );
    assert.equal(
      formatStatus({
        id: "doc-3",
        status: "error",
        error: { tag: "CRAWL_ERROR", httpStatusCode: 404 },
      }),
      "- doc-3: CRAWL_ERROR (HTTP 404)"
    );
  });
});

describe("limitOutput", () => {
  it("leaves output alone below the requested byte limit", () => {
    const output = "short output";
    assert.deepEqual(limitOutput(output, 1_000), { text: output });
  });

  it("truncates by UTF-8 bytes and reports the truncation", () => {
    const limited = limitOutput("😀".repeat(600), 1_000);

    assert.ok(limited.truncation?.truncated);
    assert.match(limited.text, /\[Output omitted:|\[Output truncated:/);
    assert.ok(Buffer.byteLength(limited.text, "utf8") <= 1_000);
    assert.doesNotMatch(limited.text, /�/);
  });

  it("enforces the hard maximum even when a larger limit is requested", () => {
    const output = Array.from({ length: 700 }, (_, index) => `${index}: ${"x".repeat(100)}`).join("\n");
    const limited = limitOutput(output, MAX_OUTPUT_BYTES * 2);

    assert.ok(limited.truncation?.truncated);
    assert.ok(Buffer.byteLength(limited.text, "utf8") <= MAX_OUTPUT_BYTES);
  });

  it("uses a dedicated notice when the first line is too large", () => {
    const limited = limitOutput("x".repeat(2_000), 1_000);

    assert.equal(limited.truncation?.firstLineExceedsLimit, true);
    assert.match(limited.text, /\[Output omitted: the first line exceeds/);
  });
});

describe("registered tool execution", () => {
  it("sends the request with authentication and returns formatted results", async () => {
    process.env.EXA_API_KEY = "test-key";

    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    setFetch(async (input, init) => {
      request = { input, init };
      return responseFrom({
        requestId: "req-123",
        costDollars: { total: 0.01 },
        results: [
          {
            id: "doc-123",
            url: "https://example.com",
            title: "Example",
            text: "Example page text",
          },
        ],
      });
    });

    const updates: unknown[] = [];
    const tool = registerTool();
    const result = await tool.execute(
      "call-1",
      { urls: ["https://example.com"] },
      undefined,
      (update: unknown) => updates.push(update)
    );

    assert.equal(request?.input, "https://api.exa.ai/contents");
    assert.equal(request?.init?.method, "POST");
    assert.deepEqual(request?.init?.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
    });
    assert.equal(
      request?.init?.body,
      JSON.stringify({ urls: ["https://example.com"], text: true })
    );
    assert.equal(updates.length, 1);
    assert.match(textFrom(result), /### Results \(1 page\)/);
    assert.match(textFrom(result), /Example page text/);
    assert.deepEqual(result.details, {
      request_id: "req-123",
      cost_dollars: { total: 0.01 },
      urls_requested: 1,
      results_count: 1,
      failed_count: 0,
      modes_used: { text: true, highlights: false, summary: false },
      output_truncated: false,
      output_limit_bytes: 40_000,
      truncation: undefined,
      statuses: [],
    });
  });

  it("includes per-URL failures and subpages in a successful response", async () => {
    process.env.EXA_API_TOKEN = "test-token";
    setFetch(async () =>
      responseFrom({
        results: [
          {
            url: "https://example.com/docs",
            title: "Docs",
            highlights: ["Useful highlight"],
            subpages: [
              {
                url: "https://example.com/docs/install",
                title: "Install",
                highlights: "Install highlight",
              },
            ],
          },
        ],
        statuses: [
          {
            id: "https://example.com/docs",
            status: "success",
            source: "cached",
          },
          {
            id: "https://example.com/missing",
            status: "error",
            error: { tag: "NOT_FOUND", httpStatusCode: 404 },
          },
        ],
      })
    );

    const tool = registerTool();
    const result = await tool.execute("call-2", {
      urls: ["https://example.com/docs", "https://example.com/missing"],
      highlights: true,
    });

    const output = textFrom(result);
    assert.match(output, /### Failed URLs/);
    assert.match(output, /NOT_FOUND \(HTTP 404\)/);
    assert.match(output, /### Successful URLs/);
    assert.match(output, /https:\/\/example\.com\/docs: success \(cached\)/);
    assert.match(output, /### Results \(1 page\)/);
    assert.match(output, /\*\*Subpages \(1\):\*\*/);
    assert.match(output, /#### Subpage 1: Install/);
    assert.deepEqual(result.details?.modes_used, {
      text: false,
      highlights: true,
      summary: false,
    });
    assert.equal(result.details?.failed_count, 1);
  });

  it("recovers empty highlights with targeted full-text requests", async () => {
    process.env.EXA_API_KEY = "test-key";

    const requests: unknown[] = [];
    setFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (requests.length === 1) {
        return responseFrom({
          requestId: "primary-request",
          results: [
            {
              id: "doc-main",
              url: "https://example.com/main",
              title: "Main",
              highlights: [],
              subpages: [
                {
                  id: "doc-sub",
                  url: "https://example.com/sub",
                  title: "Sub",
                  highlights: "   ",
                },
              ],
            },
          ],
          statuses: [
            {
              id: "https://example.com/main",
              status: "success",
              source: "cached",
            },
          ],
        });
      }
      return responseFrom({
        requestId: "fallback-request",
        costDollars: { total: 0.02 },
        results: [
          {
            id: "doc-main",
            url: "https://example.com/main",
            text: "Main full text",
          },
          {
            id: "doc-sub",
            url: "https://example.com/sub",
            text: "Sub full text",
          },
        ],
        statuses: [
          {
            id: "https://example.com/main",
            status: "success",
            source: "crawled",
          },
          {
            id: "https://example.com/sub",
            status: "success",
            source: "crawled",
          },
        ],
      });
    });

    const tool = registerTool();
    const result = await tool.execute("call-fallback", {
      urls: ["https://example.com/main"],
      highlights: true,
      fallback: "if-empty",
    });

    assert.deepEqual(requests, [
      {
        urls: ["https://example.com/main"],
        highlights: true,
      },
      {
        urls: ["https://example.com/main", "https://example.com/sub"],
        text: true,
      },
    ]);
    const output = textFrom(result);
    assert.match(output, /### Fallback Successful URLs/);
    assert.match(output, /### Fallback full text/);
    assert.match(output, /Main full text/);
    assert.match(output, /Sub full text/);
    assert.deepEqual(result.details?.fallback, {
      mode: "if-empty",
      min_characters: DEFAULT_FALLBACK_MIN_CHARACTERS,
      active: true,
      requested_urls: 2,
      request_count: 1,
      fetched_results: 2,
      secondary_used_results: 2,
      used_results: 2,
      fallback_request_ids: ["fallback-request"],
      costs: [{ total: 0.02 }],
      failed_count: 0,
      statuses: [
        {
          id: "https://example.com/main",
          status: "success",
          source: "crawled",
        },
        {
          id: "https://example.com/sub",
          status: "success",
          source: "crawled",
        },
      ],
    });
  });

  it("only recovers highlights below the configured threshold", async () => {
    process.env.EXA_API_KEY = "test-key";

    const requests: unknown[] = [];
    setFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (requests.length === 1) {
        return responseFrom({
          results: [
            {
              url: "https://example.com/short",
              highlights: "tiny",
            },
            {
              url: "https://example.com/long",
              highlights: "long enough",
            },
          ],
        });
      }
      return responseFrom({
        results: [
          {
            url: "https://example.com/short",
            text: "Recovered short page",
          },
        ],
      });
    });

    const tool = registerTool();
    const result = await tool.execute("call-short-fallback", {
      urls: ["https://example.com/short", "https://example.com/long"],
      highlights: true,
      fallback: "if-too-short",
      fallbackMinCharacters: 10,
    });

    assert.deepEqual(requests[1], {
      urls: ["https://example.com/short"],
      text: true,
    });
    const output = textFrom(result);
    assert.match(output, /Recovered short page/);
    assert.equal((output.match(/### Fallback full text/g) ?? []).length, 1);
    assert.equal(
      result.details?.fallback &&
        (result.details.fallback as Record<string, unknown>).requested_urls,
      1
    );
  });

  it("throws for missing credentials", async () => {
    const tool = registerTool();

    await assert.rejects(
      () => tool.execute("call-3", { urls: ["https://example.com"] }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("EXA_API_KEY environment variable is not set")
    );
  });

  it("turns HTTP, network, and malformed response failures into errors", async () => {
    process.env.EXA_API_KEY = "test-key";
    const tool = registerTool();

    setFetch(async () =>
      responseFrom(JSON.stringify({ error: { message: "invalid API key" } }), 401, "Unauthorized")
    );
    await assert.rejects(
      () => tool.execute("call-4", { urls: ["https://example.com"] }),
      /Exa Contents API returned HTTP 401 Unauthorized\. Details: invalid API key/
    );

    setFetch(async () => {
      throw new Error("socket closed");
    });
    await assert.rejects(
      () => tool.execute("call-5", { urls: ["https://example.com"] }),
      /Exa Contents API request failed: socket closed/
    );

    setFetch(async () => responseFrom({ notResults: true }));
    await assert.rejects(
      () => tool.execute("call-6", { urls: ["https://example.com"] }),
      /Exa Contents API returned an invalid response shape/
    );

    setFetch(async () =>
      responseFrom({ results: [{ url: "https://example.com", text: 42 }] })
    );
    await assert.rejects(
      () => tool.execute("call-6b", { urls: ["https://example.com"] }),
      /invalid response shape at results\[0\]\.text/
    );

    setFetch(async () =>
      responseFrom({
        results: [{ url: "https://example.com" }],
        statuses: [{ id: "https://example.com", status: "unknown" }],
      })
    );
    await assert.rejects(
      () => tool.execute("call-6c", { urls: ["https://example.com"] }),
      /invalid response shape at statuses\[0\]\.status/
    );

    setFetch(async () => ({
      ...responseFrom("ignored"),
      json: async () => {
        throw new Error("invalid JSON");
      },
    }));
    await assert.rejects(
      () => tool.execute("call-7", { urls: ["https://example.com"] }),
      /Failed to parse Exa Contents API response: invalid JSON/
    );
  });

  it("returns a cancellation result before or during a request", async () => {
    const tool = registerTool();
    const before = new AbortController();
    before.abort();

    const beforeResult = await tool.execute(
      "call-8",
      { urls: ["https://example.com"] },
      before.signal
    );
    assert.equal(textFrom(beforeResult), "Exa Contents request cancelled.");
    assert.equal(beforeResult.details?.error, "cancelled");

    process.env.EXA_API_KEY = "test-key";
    const during = new AbortController();
    setFetch(async (_input, init) => {
      assert.equal(init?.signal, during.signal);
      during.abort();
      throw new Error("aborted");
    });

    const duringResult = await tool.execute(
      "call-9",
      { urls: ["https://example.com"] },
      during.signal
    );
    assert.equal(textFrom(duringResult), "Exa Contents request cancelled.");
    assert.equal(duringResult.details?.error, "cancelled");
  });
});
