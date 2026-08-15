# Conversation: Exa Pi Tool Review

## User

Is this pi tool good? how could it be improved to offer the best capabilities offered by exa to an AI agent? https://github.com/gjpin/pi/blob/main/extensions/exa-contents

## Assistant

## Verdict

It’s a solid first-pass **known-URL content extractor**—roughly **6/10**—but not yet a production-grade Exa integration for an AI agent.

### What it does well

- Uses `POST /contents` correctly.
- Supports URLs/IDs, text, highlights, summaries, freshness, and subpages.
- Passes Pi’s abort signal.
- Reports per-URL crawl statuses.
- Gives the model useful prompt guidelines.

## Important fixes

### 1. It has API-schema drift

In `extensions/exa-contents/index.ts`:

- `includeHtml` should be `includeHtmlTags`.
- `includeHtmlTags` preserves lightweight HTML tags; it does **not** return raw HTML.
- `numHighlights` is not part of the current Contents API. Remove it.
- Add:
  - `text.verbosity`
  - `text.includeSections`
  - `text.excludeSections`
  - `extras.links`
  - `extras.imageLinks`
  - possibly `richLinks`, `richImageLinks`, and `codeBlocks`
- `subpageTarget` should accept either a string or an array.
- Validate API limits: URLs max 100, text/highlights max 10,000 characters, `subpages` max 100, `maxAgeHours` between `-1` and `720`.

### 2. Highlights currently do not save tokens

The code defaults to:

```ts
body.text = true;
```

Even when the model requests:

```json
{ "highlights": true }
```

Therefore the API returns both highlights **and the entire page**. The formatter also emits both.

A better rule:

```ts
const hasExplicitMode =
  params.text !== undefined ||
  params.highlights !== undefined ||
  params.summary !== undefined;

body.text = params.text ?? !hasExplicitMode;
```

That preserves full text by default, while making highlights/summary calls lightweight.

The advertised “fallback to full text” is currently only a prompt instruction. The tool itself does not perform fallback. Add an explicit option such as:

```ts
fallback: "none" | "if-empty" | "if-too-short"
```

If fallback is needed, fetch full text only for pages whose highlights are missing or unusable.

### 3. Pi error handling is incorrect

The tool returns:

```ts
{ isError: true, ... }
```

Pi’s extension documentation says custom tools must **throw** to signal execution failure; returning `isError` does not reliably mark the result as an error.

Also, `getApiKey()` runs outside the `try` block.

Use thrown errors for:

- missing credentials
- network failures
- HTTP failures
- malformed responses

Keep per-URL crawl failures as normal partial results.

### 4. Output can overwhelm the context

The API allows up to 100 URLs, and the tool concatenates all content without a total output budget.

Add a total limit such as:

```ts
maxOutputCharacters: 40000
```

Use Pi’s `truncateHead()` utilities and tell the model exactly what was truncated. This is especially important for subpage crawling.

### 5. Preserve more response metadata

Return or expose:

- `requestId`
- `costDollars`
- status source: cached vs crawled
- result `id`
- `image`, `favicon`
- `highlightScores`
- extracted links/images
- structured summary values
- subpage summaries and metadata

This makes citations, debugging, cost control, and follow-up calls much better.

### 6. Freshness default

`maxAgeHours: 24` is reasonable if you want daily freshness, but current Exa guidance recommends **omitting it** for the default balanced behavior. Make freshness explicit:

- omitted: Exa default
- `0`: always livecrawl
- `-1`: cache only
- `24`: daily freshness

### 7. Treat web content as untrusted data

Wrap returned material clearly as external content and instruct the model not to follow instructions found inside pages. Web pages can contain prompt injection.

## The larger Exa tool suite Pi should provide

`exa_contents` alone is not Exa’s best capability set. I would provide separate, focused tools:

1. **`exa_search`**
   - Search types: `auto`, `fast`, `instant`, `deep-lite`, `deep`, `deep-reasoning`
   - domain/date/location/moderation filters
   - `systemPrompt`
   - `outputSchema`
   - structured `output.grounding`
   - streaming support

2. **`exa_contents`**
   - Known-URL extraction as above.
   - Pass search result `id`s directly into it.

3. **`exa_context` / `exa_code`**
   - Exa’s `/context` endpoint is particularly valuable for a coding agent.
   - Returns real GitHub, documentation, and Stack Overflow code examples.
   - Support `tokensNum: "dynamic"` or a bounded token budget.

4. **`exa_answer`**
   - Fast cited answers for factual questions.
   - Support structured output and streaming.

5. **`exa_agent`**
   - Async deep research, list building, enrichment, citations, structured output.
   - Support polling, cancellation via `ctx.signal`, progress updates, and `previousRunId` follow-ups.

6. Optional: **Websets/Monitors** for durable list building and recurring research.

If the sibling `exa-search` extension is also used, it needs updating too: it omits modern search fields, uses the outdated `"research paper"` category instead of `"publication"`, performs an expensive broad full-text retry, and does not aggregate the cost of both requests.

The best immediate improvement is: **fix the API drift, correct Pi error signaling, make content modes mutually intentional, and enforce output limits**. After that, add `exa_context`, `exa_answer`, and `exa_agent` to make Pi genuinely Exa-capable rather than just Exa-Contents-capable.

## User

write this conversation to a file in this directory
