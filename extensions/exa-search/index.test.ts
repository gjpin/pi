import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import exaSearchExtension, {
	buildRequestBody,
	type ExaSearchParams,
	limitOutput,
} from "./index.ts";

type ToolResult = {
	content: Array<{ type: string; text: string }>;
	details?: Record<string, unknown>;
};

type RegisteredTool = {
	execute: (
		toolCallId: string,
		params: unknown,
		signal?: AbortSignal,
		onUpdate?: (result: unknown) => void,
		ctx?: unknown,
	) => Promise<ToolResult>;
};

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.EXA_API_KEY;

beforeEach(() => {
	process.env.EXA_API_KEY = "test-key";
	globalThis.fetch = originalFetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalApiKey === undefined) delete process.env.EXA_API_KEY;
	else process.env.EXA_API_KEY = originalApiKey;
});

function registerTool(): RegisteredTool {
	let registered: RegisteredTool | undefined;
	const pi = {
		registerTool(definition: unknown) {
			registered = definition as RegisteredTool;
		},
	} as unknown as ExtensionAPI;

	exaSearchExtension(pi);
	assert.ok(registered, "the extension should register a tool");
	return registered;
}

function responseFrom(
	data: unknown,
	status = 200,
	headers?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function bodyOf(init?: RequestInit): Record<string, unknown> {
	const body = init?.body;
	assert.equal(typeof body, "string");
	return JSON.parse(body as string) as Record<string, unknown>;
}

function textFrom(result: ToolResult): string {
	return result.content.find((part) => part.type === "text")?.text ?? "";
}

describe("buildRequestBody", () => {
	it("uses one highlights request and omits freshness by default", () => {
		assert.deepEqual(buildRequestBody({ query: "latest LLM research" }), {
			query: "latest LLM research",
			type: "auto",
			numResults: 10,
			moderation: true,
			contents: { highlights: true },
		});
	});

	it("forwards current Search API fields with documented nesting", () => {
		const params: ExaSearchParams = {
			query: "local news",
			type: "fast",
			numResults: 3,
			category: "publication",
			userLocation: "us",
			includeDomains: ["example.com/docs"],
			moderation: true,
			startPublishedDate: "2025-01-01",
			endPublishedDate: "2025-12-31T00:00:00Z",
			maxAgeHours: 0,
			livecrawlTimeout: 12_000,
			subpages: 2,
			subpageTarget: ["api", "reference"],
			highlights: { query: "the answer", maxCharacters: 800 },
			extras: { links: 2, imageLinks: 1 },
		};

		assert.deepEqual(buildRequestBody(params), {
			query: "local news",
			type: "fast",
			numResults: 3,
			category: "publication",
			userLocation: "US",
			includeDomains: ["example.com/docs"],
			startPublishedDate: "2025-01-01",
			endPublishedDate: "2025-12-31T00:00:00Z",
			moderation: true,
			contents: {
				highlights: { query: "the answer", maxCharacters: 800 },
				extras: { links: 2, imageLinks: 1 },
				maxAgeHours: 0,
				livecrawlTimeout: 12_000,
				subpages: 2,
				subpageTarget: ["api", "reference"],
			},
		});
	});

	it("uses publication rather than the removed research paper category", () => {
		assert.throws(
			() =>
				buildRequestBody({
					query: "papers",
					category: "research paper" as never,
				}),
			/category must be one of/,
		);
	});
});

describe("execute", () => {
	it("uses Bearer auth and makes no automatic second search", async () => {
		const tool = registerTool();
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
		globalThis.fetch = async (input, init) => {
			calls.push({ input, init });
			return responseFrom({
				requestId: "req-1",
				searchType: "auto",
				results: [
					{
						id: "doc-1",
						title: "A result",
						url: "https://example.com/page",
						highlights: ["Useful evidence"],
					},
				],
				costDollars: { total: 0.001 },
			});
		};

		const result = await tool.execute("call-1", { query: "test" });
		assert.equal(calls.length, 1);
		assert.equal(calls[0].input, "https://api.exa.ai/search");
		assert.equal(
			calls[0].init?.headers &&
				(calls[0].init.headers as Record<string, string>).Authorization,
			"Bearer test-key",
		);
		assert.deepEqual(bodyOf(calls[0].init).contents, { highlights: true });
		assert.match(textFrom(result), /<external_web_content>/);
		assert.match(textFrom(result), /doc-1/);
		assert.match(textFrom(result), /\*\*Cost:\*\* \$0\.0010/);
	});

	it("falls back through /contents only for selected sparse result IDs", async () => {
		const tool = registerTool();
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
		globalThis.fetch = async (input, init) => {
			calls.push({ input, init });
			if (String(input).endsWith("/search")) {
				return responseFrom({
					requestId: "search-1",
					results: [
						{
							id: "sparse",
							title: "Sparse",
							url: "https://example.com/sparse",
							highlights: [],
						},
						{
							id: "good",
							title: "Good",
							url: "https://example.com/good",
							highlights: ["enough"],
						},
					],
					costDollars: { total: 0.002 },
				});
			}
			return responseFrom({
				requestId: "contents-1",
				results: [
					{
						id: "sparse",
						url: "https://example.com/sparse",
						text: "Full fallback content.",
					},
				],
				costDollars: { total: 0.003 },
			});
		};

		const result = await tool.execute("call-2", {
			query: "test",
			fallback: "if-empty",
			maxFallbackResults: 1,
		});

		assert.equal(calls.length, 2);
		assert.equal(calls[1].input, "https://api.exa.ai/contents");
		assert.deepEqual(bodyOf(calls[1].init).ids, ["sparse"]);
		assert.match(textFrom(result), /Full fallback content\./);
		assert.match(textFrom(result), /\*\*Cost:\*\* \$0\.0050/);
		assert.equal(result.details?.total_cost_dollars as number, 0.005);
	});

	it("streams SSE synthesis and preserves results and grounding", async () => {
		const tool = registerTool();
		const updates: unknown[] = [];
		globalThis.fetch = async () =>
			new Response(
				[
					'data: {"requestId":"stream-1","choices":[{"delta":{"content":"answer"}}]}',
					"",
					'data: {"type":"results","requestId":"stream-1","results":[{"id":"doc-1","url":"https://example.com"}]}',
					"",
					'data: {"type":"done","requestId":"stream-1","output":{"content":"answer","grounding":[{"field":"content"}]},"costDollars":{"total":0.004},"searchTime":12}',
					"",
					"data: [DONE]",
					"",
				].join("\n"),
				{ headers: { "content-type": "text/event-stream" } },
			);

		const result = await tool.execute(
			"call-stream",
			{ query: "test", stream: true },
			undefined,
			(update) => updates.push(update),
		);
		assert.ok(updates.length > 0);
		assert.match(textFrom(result), /answer/);
		assert.match(textFrom(result), /stream-1/);
		assert.equal(result.details?.streamed, true);
	});

	it("throws bounded API errors instead of returning an apparent success", async () => {
		const tool = registerTool();
		globalThis.fetch = async () => responseFrom({ error: "bad request" }, 400);

		await assert.rejects(
			() => tool.execute("call-3", { query: "test" }),
			/Exa Search API HTTP 400.*bad request/,
		);
	});
});

describe("output limits", () => {
	it("reports truncation and respects the requested byte budget", () => {
		const limited = limitOutput(`first line\n${"x".repeat(10_000)}`, 1_000);
		assert.ok(limited.truncation?.truncated);
		assert.match(limited.text, /Output truncated/);
		assert.ok(Buffer.byteLength(limited.text, "utf8") <= 1_000);
	});
});
