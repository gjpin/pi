# Implementation Plan: Pi Feature Development Orchestrator

## 1. Goal and task context

Implement a first usable version of a Pi workflow for developing a feature through these phases:

```text
brainstorm with user
→ agree on scope
→ decompose scope into dependency-aware tasks
→ implement approved tasks
→ integrate and test task results
→ review the integrated code
→ fix must-fix review findings
```

The workflow must support different providers and models by role:

| Role | Provider/model | Thinking level |
|---|---|---|
| Interactive brainstorming, scope, and task decomposition | `openai-codex/gpt-5.6-sol` | `medium` |
| Task implementation | `openrouter/deepseek/deepseek-v4-flash-0731` | `max` |
| Final code review | `openai-codex/gpt-5.6-luna` | `xhigh` |

If OpenAI API credentials are used instead of a ChatGPT/Codex subscription, the two OpenAI model selectors may be changed from `openai-codex/...` to `openai/...`. Do not silently change providers during implementation.

The workflow is intended to be launched inside the repository where the feature will be developed. It must not require changes to Pi core.

## 2. Selected implementation approach

Build the smallest useful version from Pi's existing subagent example rather than creating a new orchestration framework.

Use:

1. The shipped `examples/extensions/subagent/` extension as the subprocess runner.
2. The normal interactive Pi session as the orchestrator and user-facing planner.
3. Project-local agent definitions for the implementer and reviewer roles.
4. A project-local `/feature` prompt template that defines the complete workflow and approval gates.
5. One durable feature document per feature under `.pi/features/`.
6. Git worktrees for implementation tasks that actually run in parallel.

Do not implement a deterministic TypeScript phase state machine in this version. The approved feature document is the durable handoff artifact, and the main model follows the workflow prompt across turns. A state-machine extension can be added later if the prompt-driven workflow proves too unreliable.

## 3. Pi and repository context

Implementation workspace:

```text
/Users/zero/src/_pi
```

Pi version used while preparing this plan:

```text
@earendil-works/pi-coding-agent 0.83.0
```

The upstream subagent example is currently installed at:

```text
/opt/homebrew/Cellar/pi-coding-agent/0.83.0/libexec/lib/node_modules/
  @earendil-works/pi-coding-agent/examples/extensions/subagent/
```

Relevant upstream files:

```text
agents.ts
index.ts
README.md
agents/implementer-style examples such as worker.md and reviewer.md
prompts/implement.md
prompts/implement-and-review.md
```

Do not edit files under the Homebrew installation. Copy the reusable extension source into this workspace and retain attribution to the upstream example in its header/README.

Existing extensions in this workspace use TypeScript directly and tests use `node:test` plus `node:assert/strict`. Follow that style; do not add a test framework or runtime dependency.

## 4. Product requirements

### 4.1 Interactive planning

The main Pi session must remain interactive during brainstorming and scoping. It must:

- discuss the idea over any number of user turns
- ask clarifying questions instead of guessing
- inspect the repository when useful
- avoid changing product code before scope and plan approval
- distinguish goals, non-goals, constraints, and acceptance criteria
- require explicit user approval before leaving the scope phase
- require explicit user approval before starting implementation

The accepted approval phrases are:

```text
approve scope
approve plan
```

Equivalent casual agreement must not be treated as approval. If the user changes requirements after an approval, return to the relevant phase and obtain approval again.

### 4.2 Task planning

The task plan must:

- cover every approved acceptance criterion
- give each task a stable ID such as `T1`, `T2`, and `T3`
- state dependencies using task IDs
- name expected files or file areas
- include a concrete acceptance check
- identify a parallel execution wave
- call out shared resources that force serialization
- be unambiguous enough for a weaker implementation model with no conversation context

Before approval, validate the plan conceptually:

- no missing dependency IDs
- no dependency cycles
- every task is reachable from the approved scope
- tasks in the same parallel wave have no expected file overlap
- tasks touching migrations, lockfiles, generated schemas, package manifests, central registries, or other shared state are serialized

### 4.3 Implementation

Each implementation subagent must:

- receive only the approved feature document plus one fully specified task
- use `openrouter/deepseek/deepseek-v4-flash-0731:max`
- work in an isolated git worktree when running concurrently
- implement only its assigned task
- run task-specific checks
- commit its changes to its task branch
- return the commit SHA, files changed, checks run, and blockers
- stop and report ambiguity rather than expanding scope

### 4.4 Integration

The main orchestrator must:

- integrate dependency waves in order
- cherry-pick completed task commits in stable task-ID order
- stop on conflicts rather than silently discarding changes
- run combined checks after each wave
- run the repository's final relevant test/typecheck/lint commands after all waves
- never stash, reset, overwrite, or commit unrelated user changes

### 4.5 Review

The reviewer must:

- use `openai-codex/gpt-5.6-luna:xhigh`
- review the integrated diff against the approved scope and acceptance criteria
- use read-only tools and read-only git commands
- report exact paths and line numbers
- separate critical findings, warnings, and suggestions
- explicitly identify unimplemented acceptance criteria
- not modify code

Critical findings are sent to the DeepSeek implementer for one fix pass. After fixes, rerun relevant checks and one final review. Do not create an unbounded review/fix loop.

## 5. Proposed files

Create:

```text
extensions/subagent/
├── index.ts
├── agents.ts
├── README.md
├── agents.test.ts
└── index.test.ts

.pi/agents/
├── feature-implementer.md
└── feature-reviewer.md

.pi/prompts/
└── feature.md
```

Created at workflow runtime, not committed as starter placeholders:

```text
.pi/features/<feature-slug>.md
```

Do not add SDK integration, a database, a task service, or a new npm dependency.

## 6. Subagent extension implementation

### 6.1 Copy and adapt the upstream example

Copy `agents.ts`, `index.ts`, and `README.md` from Pi's shipped `subagent` example into `extensions/subagent/`.

Preserve these existing capabilities:

- isolated `pi --mode json -p --no-session` subprocesses
- model selection from agent frontmatter
- per-agent tool allowlists
- single, parallel, and chain invocation modes
- per-task `cwd`
- streaming progress
- abort propagation to child processes
- concurrency limits
- bounded model-visible output
- final output and usage details

Keep the upstream limits unless a test demonstrates a reason to change them:

```text
maximum parallel tasks: 8
maximum concurrent tasks: 4
parallel output cap: 50 KB per task
```

Do not add worktree creation to the subagent extension. Worktree setup and integration belong to the main workflow because they require repository-specific user decisions and conflict handling.

### 6.2 Agent discovery

Retain project agent discovery from the nearest `.pi/agents/` directory. The workflow prompt must invoke the subagent tool with:

```json
{
  "agentScope": "project",
  "confirmProjectAgents": false
}
```

This is acceptable only because Pi's project trust gate must already have approved the repository before project-local resources load. Document that project agent prompts are repository-controlled and must not be used in untrusted repositories.

Do not broaden discovery to arbitrary directories.

### 6.3 Child invocation requirements

Verify that a model selector from frontmatter is passed unchanged to Pi's `--model` option. This is required so selectors containing a provider and thinking suffix work, for example:

```text
openai-codex/gpt-5.6-luna:xhigh
```

Verify that the task-specific `cwd` is used as the child process working directory.

Retain `shell: false` for child process spawning. Do not construct a shell command from model-provided values.

### 6.4 Failure behavior

The parent model must receive enough information to distinguish:

- unknown agent
- non-zero child exit
- model stop reason `error`
- model stop reason `aborted`
- no final assistant output
- user cancellation/abort

Parallel execution may return partial success, but a dependency wave is not complete until every required task has succeeded and been integrated.

## 7. Agent definitions

### 7.1 `.pi/agents/feature-implementer.md`

Frontmatter:

```yaml
---
name: feature-implementer
description: Implements one approved feature task in an isolated worktree
model: openrouter/deepseek/deepseek-v4-flash-0731:max
tools: read, grep, find, ls, bash, edit, write, cymbal
---
```

The body must tell the agent:

1. It has no access to the planning conversation.
2. Read the exact feature document path supplied in the task.
3. Implement only the supplied task ID.
4. Treat scope, non-goals, allowed files, dependencies, and acceptance checks as binding.
5. Inspect existing code before editing and reuse repository conventions.
6. Do not modify files outside the task's declared files unless strictly required.
7. If an undeclared file is required, stop and report why; do not expand the task silently.
8. Run the task's acceptance commands plus the smallest relevant regression check.
9. Commit only task-related changes.
10. Never stage unrelated existing changes.

Require this final response shape:

```markdown
## Status
completed | blocked | failed

## Task
T<n>

## Commit
<full commit SHA, or "none">

## Files Changed
- `path` - summary

## Checks
- `<command>` - passed/failed

## Blockers
- none, or an exact question/problem
```

### 7.2 `.pi/agents/feature-reviewer.md`

Frontmatter:

```yaml
---
name: feature-reviewer
description: Reviews an integrated feature against its approved scope and base revision
tools: read, grep, find, ls, bash, cymbal
model: openai-codex/gpt-5.6-luna:xhigh
---
```

The body must tell the agent:

1. Read the supplied feature document first.
2. Review the range `<base-sha>..HEAD` and the current integrated files.
3. Use bash only for read-only commands such as `git status`, `git diff`, `git log`, and `git show`.
4. Do not edit files, install dependencies, run formatters, or commit.
5. Check correctness, security, regressions, error handling, concurrency, tests, and every acceptance criterion.
6. Prefer actionable findings over style commentary.
7. Include exact path and line numbers.

Require this final response shape:

```markdown
## Scope Coverage
- [x] criterion
- [ ] criterion - explanation

## Critical
- `path:line` - issue and required correction

## Warnings
- `path:line` - issue

## Suggestions
- `path:line` - optional improvement

## Verdict
approved | changes-required
```

Use `None.` for empty finding sections so the parent can distinguish no findings from missing output.

## 8. Durable feature document

The main model must create `.pi/features/<feature-slug>.md` only after scope is approved. Use a lowercase hyphenated slug. If a file with that slug exists, ask before replacing it.

The document must remain self-contained because workers and reviewers have no parent-session context.

Required format:

```markdown
# Feature: <name>

## Status
scope-approved | plan-approved | implementing | reviewing | complete

## Original request
<short user request>

## Goal
<one paragraph>

## Scope
- included behavior

## Non-goals
- explicitly excluded behavior

## Constraints and decisions
- approved technical/product decisions and why

## Acceptance criteria
- AC1: observable criterion
- AC2: observable criterion

## Repository checks
- `<command>` - when to run it

## Implementation base
- Branch: `<integration branch>`
- Base SHA: `<full SHA>`

## Task graph

### T1: <title>
- Covers: AC1
- Depends on: none
- Parallel wave: 1
- Expected files: `path`, `path`
- Shared resources: none
- Work: exact implementation instructions
- Acceptance: exact expected behavior
- Checks: `<command>`

### T2: <title>
...

## Integration log
- T1: pending | `<commit>` | integrated | failed

## Review log
- pending
```

Update only status and log sections after plan approval. Do not rewrite approved scope or acceptance criteria during implementation unless the user explicitly reopens scope.

## 9. `/feature` prompt template

Create `.pi/prompts/feature.md` with frontmatter:

```yaml
---
description: Develop a feature through brainstorming, scoped planning, isolated implementation, and review
argument-hint: "<feature idea>"
---
```

The prompt receives the original idea through `$@` and must contain the complete orchestration instructions below.

### Phase A: Preflight

1. Confirm the current model is `gpt-5.6-sol` with medium thinking. The normal launch command supplies this; if it is not true, tell the user exactly which model to select before continuing.
2. Determine whether the directory is a git repository.
3. Read applicable `AGENTS.md`/`CLAUDE.md` instructions and identify standard test commands.
4. Do not create branches, worktrees, commits, or product-code changes yet.

### Phase B: Brainstorm

- Discuss goals, users, expected behavior, alternatives, constraints, and risks.
- Ask focused questions one group at a time.
- Inspect relevant code when it will improve the discussion.
- Do not present scope as final until the user says they are ready.

### Phase C: Scope approval

Present:

- goal
- in-scope behavior
- non-goals
- constraints and decisions
- observable acceptance criteria
- unresolved questions

If unresolved questions remain, continue discussion. Otherwise ask the user to reply exactly `approve scope` or request changes.

After `approve scope`, create `.pi/features/<slug>.md` with the approved sections and `Status: scope-approved`.

### Phase D: Task decomposition and approval

Read the relevant implementation paths deeply enough to write tasks with no ambiguity. Produce the dependency graph and parallel waves using the format from section 8.

Show the user:

- task IDs and titles
- dependencies
- parallel waves
- expected file ownership
- checks
- integration order

Ask for exact `approve plan`. On approval, write the task graph into the feature document and set `Status: plan-approved`.

### Phase E: Git safety and setup

Before changing code:

1. Run `git status --porcelain`.
2. If unrelated changes exist, stop and ask the user how to proceed. Never stash, reset, clean, or include them automatically.
3. Record the full current SHA as the implementation base.
4. Create or switch to an integration branch named `pi-feature/<slug>` only after user confirmation if branch creation changes their current branch.
5. Update the feature document with the base SHA and integration branch, then commit that document as the first workflow commit if the repository tracks `.pi/features/`.

If the directory is not a git repository, explain that writable tasks must run sequentially and ask whether to continue without worktrees. Do not pretend parallel writes are isolated.

### Phase F: Execute dependency waves

For each wave:

1. Select tasks whose dependencies have been integrated.
2. Recheck that concurrently running tasks do not overlap expected files or shared resources.
3. For one ready task, a normal sequential subagent call is acceptable.
4. For multiple independent writable tasks, create one sibling worktree and branch per task from the current integration HEAD.

Use branch names:

```text
pi-feature/<slug>/<task-id-lowercase>
```

Use sibling worktree paths rather than placing nested worktrees in the repository:

```text
<parent-directory>/.pi-worktrees/<repository-name>/<slug>/<task-id-lowercase>
```

5. Invoke `subagent` in parallel mode with one `feature-implementer` task per worktree. Set each task's `cwd` to its worktree and include:
   - absolute feature document path
   - task ID and full task text
   - dependency commits already integrated
   - allowed/expected files
   - acceptance criteria
   - exact checks
   - requirement to commit and return the SHA
6. Set `agentScope: "project"` and `confirmProjectAgents: false`.
7. If any worker is blocked or failed, do not start dependent tasks. Present the blocker to the user or clarify it and rerun only that task.
8. Cherry-pick successful commits into the integration branch in task-ID order.
9. On a cherry-pick conflict, abort the cherry-pick and report the conflicting files. Resolve only with explicit reasoning; never choose one side wholesale.
10. Run combined checks for the wave.
11. Update and commit the integration log.
12. Remove completed worktrees after their commits are safely integrated. Do not force-remove a worktree with uncommitted changes.

Sequential tasks may run in the integration checkout, but they must still use `feature-implementer`, produce a dedicated commit, and follow the same result contract.

### Phase G: Final verification

After every task is integrated:

- run all repository checks recorded in the feature document
- inspect `git diff <base-sha>..HEAD --stat`
- verify every acceptance criterion has corresponding implementation and test evidence
- set the feature status to `reviewing`

Do not proceed to review while required checks are failing unless the failure is documented and the user explicitly accepts it.

### Phase H: Review and bounded fix pass

Invoke `feature-reviewer` as a single subagent in the integration checkout. Supply:

- feature document path
- base SHA
- integration branch
- final check results
- instruction to review `<base-sha>..HEAD`

If verdict is `approved`, record it and finish.

If verdict is `changes-required`:

1. Present the findings to the user.
2. Delegate critical findings to `feature-implementer` as one focused fix task.
3. Apply warnings only when clearly required by an acceptance criterion or explicitly approved by the user.
4. Run relevant checks and commit the fix.
5. Run `feature-reviewer` one final time.
6. If critical findings remain, stop and report them; do not loop indefinitely.

### Phase I: Completion

Set the feature document status to `complete` only when:

- every task is integrated
- required checks pass or have explicit user acceptance
- no critical review findings remain

Return a concise summary containing:

- feature document path
- integration branch and base SHA
- task commits
- files changed
- checks and outcomes
- final review verdict
- remaining warnings or follow-up work

Do not automatically merge to the user's main branch, push, open a pull request, or delete the integration branch.

## 10. Model and authentication setup

Document these setup steps in `extensions/subagent/README.md`:

```text
/login openrouter
/login openai-codex
```

Refresh and verify catalogs:

```bash
pi update --models
pi --list-models deepseek-v4-flash-0731
pi --list-models gpt-5.6
```

The desired selectors are:

```text
openai-codex/gpt-5.6-sol:medium
openrouter/deepseek/deepseek-v4-flash-0731:max
openai-codex/gpt-5.6-luna:xhigh
```

OpenRouter catalogs may only expose a model after authentication/catalog refresh. If the desired OpenRouter model is absent, document how to add its verified OpenRouter model ID through `~/.pi/agent/models.json`; do not invent context-window, output-limit, or pricing metadata. Do not silently fall back to the direct `deepseek` provider.

Recommended launch command from a target repository:

```bash
pi \
  -e /Users/zero/src/_pi/extensions/subagent/index.ts \
  --model openai-codex/gpt-5.6-sol:medium \
  --models 'openai-codex/gpt-5.6-sol:medium,openrouter/deepseek/deepseek-v4-flash-0731:max,openai-codex/gpt-5.6-luna:xhigh'
```

Then invoke:

```text
/feature <feature idea>
```

The target repository must contain or load the `.pi/agents` and `.pi/prompts` resources created by this implementation. For initial development, test in `/Users/zero/src/_pi`. Packaging/global installation is deferred.

## 11. Automated tests

### 11.1 `agents.test.ts`

Use temporary directories and `node:test` to verify:

- project agents are discovered from the nearest `.pi/agents/`
- an agent's provider-qualified model selector is preserved exactly
- comma-separated tool names are trimmed and parsed
- files without required `name` or `description` are ignored
- project agents override same-named user agents when scope is `both`, if practical without mutating the real home directory
- `formatAgentList` reports truncation correctly

Do not write to the real `~/.pi/agent/agents` directory during tests.

### 11.2 `index.test.ts`

Mock `ExtensionAPI` and child process boundaries where practical. Verify:

- the extension registers a tool named `subagent`
- exactly one of single, parallel, or chain mode is required
- unknown agents return a useful list of available agents
- more than eight parallel tasks is rejected
- parallel output remains in input order even when completion order differs
- per-task `cwd` is forwarded
- frontmatter model selectors are forwarded to `--model`
- abort terminates the child process path
- child errors and non-zero exits are visible to the parent

Do not call paid model APIs in automated tests.

If directly mocking `node:child_process.spawn` would require invasive production abstractions, keep one small injected spawn function or export one pure invocation builder. Do not introduce a class hierarchy solely for testing.

### 11.3 Resource validation

Add a small test or test helper that parses the two agent markdown files and the prompt frontmatter, asserting:

- required names/descriptions are present
- expected model selectors are exact
- reviewer tools omit `edit` and `write`
- prompt template references `$@`
- prompt contains both approval phrases

## 12. Manual verification

### 12.1 Startup

From `/Users/zero/src/_pi`:

```bash
pi -e ./extensions/subagent/index.ts \
  --model openai-codex/gpt-5.6-sol:medium
```

Verify startup lists:

- the subagent extension
- `feature-implementer`
- `feature-reviewer`
- `/feature`

### 12.2 Interactive gates

Run:

```text
/feature add a deliberately small feature to a disposable git repository
```

Verify:

1. The model brainstorms instead of immediately coding.
2. Product files remain unchanged before approvals.
3. Scope is not accepted without the exact `approve scope` phrase.
4. The feature document is self-contained after approval.
5. Implementation does not start without exact `approve plan`.

### 12.3 Sequential task

Use a one-task feature and verify:

- DeepSeek is the child model shown by the subagent result
- only the declared task is implemented
- the worker commits its changes
- checks and commit SHA are returned
- Luna performs the final review

### 12.4 Parallel tasks

Use two independent tasks that modify separate files and verify:

- two sibling worktrees are created from the same integration HEAD
- workers run concurrently with distinct `cwd` values
- each task creates one commit
- commits are integrated in task-ID order
- combined checks run after integration
- worktrees are removed safely

Also test a plan with overlapping files and verify the tasks are serialized rather than run concurrently.

### 12.5 Failure and safety paths

Verify:

- a dirty starting checkout causes a user-visible stop
- a blocked worker prevents dependent tasks from starting
- an integration conflict is not silently resolved
- aborting Pi terminates running subagents
- a reviewer cannot call `edit` or `write`
- critical findings cause at most one automatic fix/re-review cycle
- no branch is pushed or merged to main automatically

## 13. Acceptance criteria

The implementation is complete when:

1. `/feature <idea>` starts an interactive brainstorm with GPT-5.6 Sol medium.
2. Scope and plan each require explicit user approval.
3. The resulting `.pi/features/<slug>.md` is sufficient for an agent with no prior context.
4. The plan records dependencies, parallel waves, files, acceptance criteria, and checks.
5. Implementation tasks run with OpenRouter DeepSeek V4 Flash.
6. Independent writable tasks can run concurrently in separate git worktrees.
7. Dependent or overlapping tasks run in sequence.
8. Task commits are integrated and tested in dependency order.
9. GPT-5.6 Luna xhigh reviews the integrated diff without write tools.
10. Critical review findings receive one bounded DeepSeek fix pass and final review.
11. Abort, dirty checkout, failed task, and merge-conflict paths fail safely.
12. The workflow never pushes, merges to main, resets, stashes, or deletes user work without explicit action.

## 14. Non-goals for this version

Do not implement:

- a custom Pi SDK application
- a web UI or RPC orchestration service
- a general-purpose workflow engine
- deterministic TypeScript phase persistence
- automatic natural-language approval classification
- a task database
- remote/distributed workers
- automatic pull requests or pushes
- automatic merge to the user's main branch
- arbitrary user-configurable role graphs
- retries without a clear failure reason
- an unbounded review/fix loop
- global packaging or installation automation

## 15. Deferred follow-up

After real use, consider a dedicated extension only if prompt-driven orchestration proves unreliable. That extension may add:

- explicit phase state persisted with `pi.appendEntry()`
- `ctx.ui.editor()` and `ctx.ui.confirm()` approval dialogs
- `pi.setModel()` and `pi.setThinkingLevel()` on phase transitions
- automatic DAG validation and scheduling
- a progress widget via `ctx.ui.setWidget()`
- automatic worktree lifecycle management
- resumable task state across Pi sessions

Do not build these until the minimal workflow has been exercised on real features and its failure modes are known.
