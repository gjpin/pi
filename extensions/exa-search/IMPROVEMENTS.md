# Exa Search Extension Improvements

## Assessment

`extensions/exa-search/index.ts` is already strong: it uses the correct nested `contents` shape, defaults to highlights, omits freshness by default, limits output, propagates cancellation, reports costs/request IDs, and treats web content as untrusted.

The main remaining improvements are correctness at edge cases, stronger cost policy, safer truncation/streaming, and better Pi integration.

## Highest-priority fixes

### 1. Correct API-contract drift

- **Category validation:** `validateCategoryFilters()` allows `excludeDomains` for `company` searches. Current Exa coding-agent and best-practices docs say both `company` and `people` reject it. Exa’s documentation is somewhat inconsistent here, so add a live contract test and follow the canonical Search API guide.
- **Deprecated search type field:** `responseSearchType()` prefers `resolvedSearchType`, which Exa marks deprecated and may return as `""`. This is why output can show a blank search type. Prefer a non-empty `searchType`, then the requested type.
- **Summary schemas:** `summary.schema` is passed through `validateJsonSchema()`, imposing Search `outputSchema` limits—10 properties, depth 2, and forbidden citation/confidence fields. Those restrictions are documented for Search synthesis, not Contents summary schemas. Split this into:
  - generic JSON-schema validation for `summary.schema`
  - compact Search-specific validation for `outputSchema`
- **Fallback attribution:** `fallback.used > 0` is passed to every result at line 1775. Track exactly which result IDs received fallback text, otherwise unrelated `result.text` values can be labeled as fallback content.
- Rename “Fallback full text” to “Fallback text excerpt,” since it is capped at 5,000 characters.

### 2. Put cost controls outside the model’s control

The API schema permits expensive fan-out:

- 100 search results
- 100 subpages per result
- multiple content modes
- per-page summaries
- deep-reasoning searches
- an additional fallback request

Use user-controlled extension configuration—not an `allowExpensive` argument the model can set—to enforce limits such as:

```text
maxResults: 25
maxSubpagesPerResult: 10
maxTotalPages: 50
allowMultipleContentModes: false
allowSummaries: true
allowDeepReasoning: true
maxEstimatedRequestCostUsd: 0.05
```

Also:

- Reject stacking `text`, `highlights`, and `summary` by default.
- Warn that results above 10 incur additional charges.
- Describe current base costs for deep modes in the tool schema.
- Represent unavailable `costDollars` as unknown rather than treating it as `$0`.
- Consider opt-in, short-lived caching or in-flight deduplication for identical requests.

### 3. Improve retry and deadline semantics

`MAX_RETRIES = 1` retries POST requests after network failures. If Exa received the first request but the response was lost, that can duplicate charges.

Recommended behavior:

- Retry `429` and explicit `5xx` responses with exponential full jitter.
- Honor the complete `Retry-After` value rather than capping it at five seconds, subject to an overall deadline.
- Be conservative about retrying ambiguous network failures after a request may have been transmitted.
- Make `requestTimeoutMs` an overall operation deadline. It currently applies per attempt, and then again to fallback, so a nominal 90-second request can take several minutes.
- Use a separate, shorter Contents fallback timeout.
- Correctly report timeout during `response.text()`; it currently becomes “response could not be read.”

### 4. Make output limiting structural

Current truncation can:

- remove everything if the first line contains a long query
- cut inside `<external_web_content>`
- leave Markdown fences or provenance wrappers open
- build and format up to 8 MB only to discard most of it
- duplicate truncated output in `details.truncation.content`

Improvements:

- Truncate the echoed query/title/URL independently.
- Format incrementally against the output budget, result by result.
- Always close untrusted-content boundaries.
- Store only truncation metadata in `details`; `TruncationResult.content` currently duplicates as much as 50 KB in the session.
- Following Pi’s guidance, optionally save the complete formatted output to a mode-`0600` temp file and return its path.
- Hide low-value metadata such as favicon, image, and highlight scores by default; expose it through an option or `details`.

## Streaming

The compatibility handling is sensible, but streaming needs stronger contract tests.

- Treat the documented OpenAI-compatible `choices[].delta.content` format as canonical.
- Keep typed-event support only as explicit compatibility behavior.
- Test fragmented SSE frames, multiline `data:`, CRLF, citations, reset, error, malformed JSON, cancellation, and oversized streams.
- Clarify that streaming is for synthesized output; require `outputSchema` unless verified API behavior makes streaming without it useful.
- Throttle `onUpdate`—it currently emits the entire accumulated prefix for every token/chunk, causing roughly quadratic UI work.
- Wrap/sanitize streamed previews as untrusted content too.
- Avoid relying on a stream to return ordinary search results, request cost, or result IDs unless the current stream contract guarantees them.

## Security and privacy

The fixed HTTPS API origin and API-key redaction are good. Further improvements:

- Explain that `moderation:true` filters unsafe results but **does not prevent prompt injection**.
- Preserve explicit untrusted provenance even after truncation.
- Redact the key and control characters from streaming and network error paths too.
- Trim and reject blank/whitespace-only API keys.
- Validate domain filters as domains/path patterns rather than arbitrary 2,048-character strings.
- Add optional user-controlled domain allowlists for restricted environments.
- Scan or reject obvious credentials in every outbound textual field—not only `query`, but also `systemPrompt`, `additionalQueries`, highlight/summary queries, and subpage targets.
- Document that queries and results are sent to Exa and persisted in Pi session files. Mention Enterprise Zero Data Retention and HIPAA behavior.
- Validate HIPAA-incompatible combinations early where possible; HIPAA requests fail closed for live retrieval, summaries, and other noncompliant paths.

## Pi-specific improvements

According to Pi’s extension documentation:

- Every `promptGuidelines` bullet must name the tool. Most bullets at line 2114 do not explicitly say `exa_search`.
- Reduce the eight static guidelines to four concise, tool-named rules to lower prompt overhead.
- Remove repeated usage guidance from every result at lines 1800–1802; it already belongs in the system prompt.
- Add compact `renderCall`/`renderResult` implementations showing query, type, result count, duration, cost, fallback, and truncation. Raw web content should appear only when expanded.
- Use `ctx.getContextUsage()` to reduce the output budget when little model context remains.
- Make references to `exa_contents` conditional or bundle it. At present this directory contains only `exa_search`, yet the tool repeatedly instructs the model to call `exa_contents`.

## Testing and maintainability

The existing tests cover only the happy path, one fallback, a synthetic stream, and a basic error.

Add tests for:

- every category/filter restriction
- content-mode conflicts and cost guards
- schema-depth/property validation
- empty deprecated `resolvedSearchType`
- fallback mapping and per-URL statuses
- retries, `Retry-After`, overall deadlines, and cancellation during body reads
- Unicode byte limits and long first lines
- structurally safe truncation
- API-key redaction in every error path
- malformed and oversized responses
- documented SSE fixtures

Also add a `package.json`/test setup and README. In this checkout:

```text
node --test extensions/exa-search/index.test.ts
```

fails because `@earendil-works/pi-ai` cannot be resolved outside Pi’s installed runtime.

## Broader tool design

Keep `exa_search` focused on discovery. For the best agent experience, bundle separate tools:

1. `exa_search` — web discovery and optional synthesis
2. `exa_contents` — known URL/result-ID extraction
3. `exa_context` — code and API examples; especially useful for Pi
4. `exa_answer` — question-first cited answers
5. `exa_agent` — async deep research/list-building

This follows Exa’s endpoint-selection guidance and keeps the Search tool from becoming even more complex.

Relevant documentation: [Search API for coding agents](https://exa.ai/docs/reference/search-api-guide-for-coding-agents), [Search best practices](https://exa.ai/docs/reference/search-best-practices), [Pricing](https://exa.ai/docs/reference/pricing), and [Error codes](https://exa.ai/docs/reference/error-codes).
