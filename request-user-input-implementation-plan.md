# Implementation Plan: Pi `request_user_input` Tool

## 1. Task context

Implement a Pi coding-agent extension that lets the model pause and request structured input from the human user. The interaction should resemble OpenAI Codex's `request_user_input` tool, using these Codex files as behavioral references:

- `codex-rs/core/src/tools/handlers/request_user_input.rs`
- `codex-rs/core/src/tools/handlers/request_user_input_spec.rs`
- `codex-rs/protocol/src/request_user_input.rs`
- Codex's TUI request-user-input implementation under `codex-rs/tui/src/bottom_pane/request_user_input/`

The extension is intended for normal interactive terminal Pi usage. It should not require changes to Pi core.

## 2. Confirmed product requirements

1. The tool accepts **one to three questions**, Codex-style.
2. Initial implementation is **TUI-only**.
   - RPC mode is not required because the intended host is the normal Pi terminal UI.
   - JSON, print, and RPC modes should fail clearly rather than hang or fabricate input.
3. The first model-provided option is always the model's recommendation.
   - It must be the first option in the schema.
   - It must be selected by default.
   - The UI must mark it as `(Recommended)`.
4. The client automatically appends a final `None of the above` option.
   - The model must not provide its own catch-all option.
   - Selecting it opens free-form input.
5. Each question supports optional **multiline free-form notes**, even after selecting a normal option.
   - Selecting `None of the above` requires a non-empty free-form answer.
6. Cancellation should be a normal tool result, not a tool execution error.
7. The implementation should use Codex-compatible answer formatting where practical.
8. Do not implement `isSecret`, `autoResolutionMs`, or `isBlocking` in this version.

## 3. Codex behavior to preserve

### Input shape

The public tool arguments should be approximately:

```json
{
  "questions": [
    {
      "id": "database",
      "header": "Database",
      "question": "Which database should we use?",
      "options": [
        {
          "label": "PostgreSQL",
          "description": "Best fit for the required relational queries."
        },
        {
          "label": "SQLite",
          "description": "Simpler deployment but less suitable for concurrent writes."
        }
      ]
    }
  ]
}
```

Question constraints:

- `questions`: 1–3 items
- `id`: stable, unique, snake_case identifier
- `header`: short UI label, maximum 12 characters
- `question`: concise user-facing prompt
- `options`: 2–3 mutually exclusive model-provided options
- option `label` and `description`: both required
- no model-provided `Other`/`None of the above` choice

The tool description and prompt guidelines must tell the model to put its recommendation first and not include an `Other` option.

### Output shape

For a normal selection without notes:

```json
{
  "answers": {
    "database": {
      "answers": ["PostgreSQL"]
    }
  }
}
```

For a normal selection with notes, use Codex's existing convention:

```json
{
  "answers": {
    "database": {
      "answers": [
        "PostgreSQL",
        "user_note: Reuse the existing database schema."
      ]
    }
  }
}
```

For `None of the above`:

```json
{
  "answers": {
    "database": {
      "answers": [
        "None of the above",
        "user_note: Use MySQL instead."
      ]
    }
  }
}
```

Only one option may be selected per question. The `answers` array is retained for Codex compatibility and contains the selected option followed by an optional note.

For cancellation, return a normal tool result such as:

```json
{
  "cancelled": true,
  "answers": {}
}
```

If useful, include committed partial answers in the cancellation result. Do not set `isError` for ordinary user cancellation.

## 4. Repository and Pi API context

Current working directory:

```text
/Users/zero/src/_pi
```

Current repository contents include extension directories such as:

```text
extensions/exa-search/
extensions/exa-contents/
extensions/compact-footer/
```

There is no need to modify Pi core. Match the existing extension style and use the Pi 0.82.x extension APIs:

- `pi.registerTool(...)`
- TypeBox schemas from `typebox`
- `ctx.ui.custom(...)` for complex TUI interaction
- `@earendil-works/pi-tui` components
- `executionMode: "sequential"`
- thrown errors for actual tool failures

Important Pi behavior:

- `ctx.ui.custom()` is TUI-specific and unavailable in RPC mode.
- Custom tool `execute()` errors must be thrown; returning `{ isError: true }` is not sufficient.
- `details` are persisted with tool results and are useful for rendering and resumed sessions.
- Tool calls execute in parallel by default, so this tool must explicitly use sequential execution.
- TUI components must respect the supplied width and should implement `Focusable` when containing an `Editor` or `Input`.

## 5. Proposed files

Create:

```text
extensions/request-user-input/
├── index.ts
├── model.ts
├── ui.ts
└── index.test.ts
```

### `model.ts`

Own all UI-independent types and logic:

- input types
- normalized question/option types
- validation
- recommendation normalization
- automatic `None of the above` insertion
- answer state types
- Codex-compatible response construction

Export pure functions so they can be tested without a live TUI.

Suggested internal types:

```ts
type RequestQuestion = {
  id: string;
  header: string;
  question: string;
  options: RequestOption[];
};

type RequestOption = {
  label: string;
  description: string;
};

type NormalizedOption = RequestOption & {
  recommended: boolean;
  isOther: boolean;
};

type DraftAnswer = {
  questionId: string;
  selectedOptionIndex?: number;
  note: string;
  committed: boolean;
};
```

### `ui.ts`

Implement the TUI questionnaire component and its state transitions.

Use Pi components such as:

- `Container`
- `Text`
- `Spacer`
- `DynamicBorder`
- `SelectList`
- `Editor`
- `Key` and `matchesKey`

The component should implement `Component` and `Focusable`, forwarding focus to the embedded multiline editor.

### `index.ts`

Own:

- tool schema and registration
- mode checks
- signal/cancellation integration
- invoking `ctx.ui.custom()`
- building tool content/details
- `renderCall`
- `renderResult`

## 6. Validation and normalization

Implement runtime validation in addition to the TypeBox schema.

Validate:

- question count is 1–3
- IDs are non-empty, unique, and match a snake_case pattern
- headers are non-empty and no longer than 12 characters
- questions are non-empty
- each question has 2–3 options
- option labels/descriptions are non-empty
- labels are unique within a question, preferably case-insensitively after trimming
- model options do not already contain a client-owned `Other`/`None of the above` option
- non-first options do not claim to be recommended

Normalization must:

1. Preserve original option labels for answer output.
2. Mark option index zero as `recommended: true`.
3. Add `(Recommended)` only to the display label if the model omitted it.
4. Append exactly one client-owned option:

```ts
{
  label: "None of the above",
  description: "Enter a different answer.",
  recommended: false,
  isOther: true,
}
```

The model cannot semantically prove that its first choice is a good recommendation, but the extension can guarantee the positional and UI invariants.

## 7. TUI interaction design

### Main view

For each question display:

- question progress, e.g. `Question 1 of 3`
- `header`
- question text
- numbered options with descriptions
- first option marked `(Recommended)`
- final `None of the above` option
- keyboard help

The first option must be highlighted by default.

### Selection and notes

Maintain per-question state:

- selected option
- multiline note draft
- whether the answer has been committed

Recommended flow:

1. Focus starts on the options list.
2. Up/down changes the selected option.
3. Enter selects the highlighted option and moves focus to the notes editor.
4. Notes are optional for normal options.
5. Notes are required for `None of the above`.
6. The editor supports multiline text.
7. Enter submits the current question; Shift+Enter should insert a newline where supported by Pi's editor/keybindings.
8. Escape from the editor returns to the options list without cancelling the entire request.
9. Escape from the options list cancels the request.
10. After submission, advance to the next question.
11. After the final question, show a review/submit view.
12. Allow navigating back to revise previous answers.

The UI should preserve drafts when moving between questions. Notes should be visible in the review view, truncated safely if necessary.

### Other-option behavior

When `None of the above` is selected:

- focus the multiline editor automatically
- show a clear prompt such as `Enter your answer`
- refuse to commit whitespace-only input
- return the fixed option label plus the `user_note:` entry

### Abort behavior

The tool receives an `AbortSignal`.

- If already aborted, return a cancelled result without opening UI.
- While the component is open, abort should call `done()` with a cancelled result.
- Remove abort listeners when the component completes or is disposed.
- Guard against `done()` being called more than once.

## 8. Tool execution behavior

Register with:

```ts
executionMode: "sequential"
```

Execution flow:

1. Check `signal.aborted`.
2. Validate and normalize arguments.
3. Require `ctx.mode === "tui"`; otherwise throw an informative error such as:

```text
request_user_input requires interactive TUI mode
```

4. Open `ctx.ui.custom()` with the questionnaire component.
5. Convert committed answers to the Codex-compatible response shape.
6. Return text content containing JSON for the model.
7. Return structured `details` for rendering and session persistence.

Suggested details shape:

```ts
{
  questions: NormalizedQuestion[];
  answers: Array<{
    questionId: string;
    header: string;
    optionLabel?: string;
    optionIndex?: number;
    recommended: boolean;
    note: string;
    wasCustom: boolean;
    committed: boolean;
  }>;
  cancelled: boolean;
}
```

Do not include unsupported `isSecret`, `autoResolutionMs`, or `isBlocking` fields in the public schema.

## 9. Tool rendering

Implement compact rendering for the Pi transcript.

### `renderCall`

Show the tool name and question count/headers while guarding against partially parsed arguments:

```text
request_user_input · 2 questions
```

### `renderResult`

Show concise summaries:

```text
✓ Database: PostgreSQL
✓ Deployment: None of the above (custom answer)
```

Use warning styling for cancellation and error styling when `context.isError` is true. Expanded output may show notes and recommendation status.

## 10. Tests

### Pure model tests

- accepts 1, 2, and 3 questions
- rejects zero or more than three questions
- rejects duplicate IDs
- rejects invalid/blank IDs
- rejects blank questions/headers/options
- rejects fewer than two or more than three model options
- rejects duplicate option labels
- appends `None of the above`
- marks only the first option recommended
- avoids duplicate `(Recommended)` suffixes
- rejects model-supplied catch-all options
- builds normal Codex-compatible answers
- builds answers with multiline notes
- builds `None of the above` answers
- builds cancellation responses

### UI/state tests

- first option is initially selected
- recommendation is displayed
- option descriptions render
- selecting a normal option opens notes
- empty normal notes are allowed
- whitespace-only `None of the above` notes are rejected
- multiline notes are preserved
- Escape from notes returns to options
- Escape from options cancels
- previous answers survive question navigation
- final review contains all answers
- rendered lines do not exceed terminal width

### Tool integration tests

Mock `ExtensionAPI` and `ctx` to verify:

- the tool registers under `request_user_input`
- `executionMode` is sequential
- TUI mode invokes `ctx.ui.custom`
- non-TUI modes throw a clear error
- pre-aborted signals return cancellation
- cancellation is not marked as `isError`
- `renderCall` and `renderResult` handle missing/partial details safely

## 11. Manual verification

Run from `/Users/zero/src/_pi`:

```bash
pi -e ./extensions/request-user-input/index.ts
```

Have the model call the tool and verify:

1. The first option is preselected and marked recommended.
2. The final option is always `None of the above`.
3. Normal options can receive multiline notes.
4. `None of the above` requires custom text.
5. Multiple questions can be answered and revised.
6. The final response contains the expected JSON shape.
7. Escape cancellation lets the model continue naturally.
8. Narrow terminal widths wrap safely.
9. Aborting Pi while the dialog is open does not leave a stuck UI.
10. A resumed session renders the persisted tool result safely.

## 12. Non-goals and future work

Do not implement in this iteration:

- RPC UI support
- JSON/print-mode prompting
- secret-input semantics
- automatic resolution/countdown timers
- nonblocking requests
- Pi core protocol changes
- multiple selections per question
- arbitrary model-provided free-form option labels

Possible later extensions:

- RPC adapter using `ctx.ui.select()` and `ctx.ui.input()`
- optional `isSecret` masking with careful session redaction
- `autoResolutionMs`/`isBlocking`
- option-specific notes display compatible with more Codex protocol consumers
