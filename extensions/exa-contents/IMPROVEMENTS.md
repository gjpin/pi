# Exa Contents Extension Improvements

## Assessment

`extensions/exa-contents/` is already solid: it uses the current endpoint shape, preserves Exa’s freshness default, checks per-URL statuses, supports aborts, throws tool errors correctly, exposes metadata, and bounds model output.

The highest-value remaining improvements are cost controls, transport hardening, stricter API compatibility, and safer formatting.

## Priority improvements

| Priority | Issue | Recommended change |
|---|---|---|
| P0 | Summary schema drift | Support `summary: boolean \| { query?: string; schema?: object }`. It currently requires an object and mandatory query at `index.ts:51-54` and `1066-1080`. |
| P0 | Unbounded fallback fan-out | Add `fallbackMaxCharacters` (default 5,000) and `maxFallbackResults` (default 3, maximum 10). Current fallback can target every root and subpage and requests unrestricted `text:true` at `393-405`. |
| P0 | HIPAA combinations are not validated | With `compliance:"hipaa"`, reject summaries, positive/zero `maxAgeHours`, and rendering options requiring livecrawl. Allow omitted freshness or `-1`, with text/highlights only. |
| P0 | Unbounded HTTP response | Cap the API response itself, not only formatted model output. Check `Content-Length`, then read through a bounded stream—perhaps 8 MB. `response.json()` at `880-889` can allocate a huge response before the 50 KB output limit applies. |
| P0 | External-content boundary is spoofable | Sanitize `</external_web_content>`, NULs, multiline titles/URLs, markdown delimiters, and code fences. The raw interpolation at `506-545` lets page content close or imitate the wrapper. Port the sanitizers already present in `extensions/exa-search/index.ts`. |
| P1 | Default contradicts agent guidance | Default to `highlights:true`, or require an explicit content mode. Defaulting to full text at `203-225` conflicts with Exa’s recommendation that agents use highlights, which are roughly 10× more token-efficient. |
| P1 | No request timeout or retry policy | Add `requestTimeoutMs`, one bounded retry for 429/500/502/503/504, `Retry-After` support, jitter, and clear timeout errors. The sibling search tool already implements this. |
| P1 | Optional fallback can destroy good primary results | If fallback fails, return the primary highlights with a warning instead of throwing away the whole result (`1250-1258`). |
| P1 | Cost reporting is incomplete | Aggregate primary and fallback costs into `total_cost_dollars` and include a compact cost line in tool `content`; Pi `details` are for state/rendering and are not the main LLM-visible output. |
| P1 | Head-only truncation starves later results | Allocate a fair per-result budget or emit a compact manifest for every result before page content. Currently one large first page can hide all later pages. Save complete truncated output to a mode-0600 temp file, per Pi’s tool guidance. |
| P2 | Weak semantic validation | Deduplicate sources; validate `urls` as HTTP(S); reject embedded credentials; reject fallback without highlight-only mode; warn/reject `subpageTarget` without `subpages`; require nonempty section arrays. |
| P2 | Credential aliases are surprising | Prefer only the documented `EXA_API_KEY`. At minimum remove generic `EXA_KEY`, which could accidentally transmit an unrelated secret (`171-176`). |

## Cost controls are especially important

Exa currently bills `/contents` at **$1 per 1,000 pages per content type**. Text, highlights, and summary are separate billable views.

The current public limits permit:

- 100 root URLs
- 100 subpages per root
- multiple content modes
- another unrestricted text fallback over sparse results

That is an upper bound of 10,100 pages per mode, most of which could then be discarded by the 50 KB output limit. Add a **user-owned policy ceiling**, not merely a model-settable override, such as:

- maximum roots per call
- maximum estimated root + subpage pages
- maximum active content modes
- maximum fallback pages
- optional maximum estimated billable page-types

If configured from project files, only honor it when `ctx.isProjectTrusted()`.

## Improve interaction with `exa_search`

The guideline at `1158` encourages calling Contents after search. Current Exa guidance says content requested directly through `/search` is included for the first ten search results, so an immediate `/contents` call may be redundant.

Change the guidance to:

> Use `exa_contents` when URLs are already known or when a search result needs deeper or differently configured retrieval. Prefer requesting highlights/text directly in `exa_search` when searching, to avoid a second call.

Keep Search and Contents as separate focused tools rather than combining them.

## Suggested schema additions

```ts
summary?: boolean | {
  query?: string;
  schema?: Record<string, unknown>;
};

fallbackMaxCharacters?: number; // default 5,000
maxFallbackResults?: number;    // default 3, max 10
requestTimeoutMs?: number;      // default 60,000, max 120,000
```

Consider renaming `maxOutputCharacters` to `maxOutputBytes`; it currently measures UTF-8 bytes despite its name.

## Maintainability and tests

Share the following with `extensions/exa-search/` instead of maintaining two implementations:

- HTTP client, timeout, retry and API-key redaction
- response-size limiting
- Exa response validators
- external-content sanitization
- formatting and truncation
- cost aggregation
- fallback selection

Add tests for:

- `summary:true` and summary without query
- every invalid HIPAA combination
- fallback caps and partial fallback failure
- duplicate URLs
- 429 retry and timeout
- oversized responses
- aggregate costs
- malicious titles/content containing closing tags, newlines, backticks, fences, and NULs
- large first result followed by small later results

Official references: [Contents coding-agent guide](https://exa.ai/docs/reference/contents-api-guide-for-coding-agents), [Contents best practices](https://exa.ai/docs/reference/contents-best-practices), [Pricing](https://exa.ai/pricing?tab=api), [HIPAA](https://exa.ai/docs/reference/security/hipaa), and [Rate limits](https://exa.ai/docs/reference/rate-limits).
