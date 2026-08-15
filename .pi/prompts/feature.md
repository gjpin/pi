---
description: Develop a feature through brainstorming, scoped planning, isolated implementation, and review
argument-hint: "<feature idea>"
---

Develop this feature through the workflow below:

> $@

The planning conversation is the source of proposals; the approved feature document is the durable source of truth. Do not modify product code until both exact approval gates have passed.

## A. Preflight

1. Confirm the active model is `openai-codex/gpt-5.6-sol` with `medium` thinking. If not, stop and tell the user to select `openai-codex/gpt-5.6-sol:medium` (or the explicitly configured `openai/...` equivalent).
2. Determine whether the current directory is a git repository.
3. Read all applicable `AGENTS.md` and `CLAUDE.md` instructions and identify standard test, typecheck, and lint commands.
4. Do not create branches, worktrees, commits, feature documents, or product-code changes yet.
5. Run the `check-workflow-deps` tool to verify repository exploration dependencies. If the tool reports an error (`isError`), return its output to the user and do not continue.
6. Do not install or modify dependencies.

## B. Brainstorm

Discuss goals, users, expected behavior, alternatives, constraints, and risks over as many turns as needed. Ask focused questions one group at a time; inspect relevant repository code when useful. Do not guess unresolved requirements or present scope as final until the user says they are ready.

After brainstorming, before presenting scope, resolve any functional ambiguity:

5. Identify ambiguous or underspecified aspects of the request. Ask focused clarification questions to the user. Do not proceed until the functional intent is clear enough that an explorer can navigate relevant code paths.
6. Read the project agent `codebase-explorer` from `.pi/agents/codebase-explorer.md` (if present) and understand its evidence contract.
7. Invoke the `subagent` tool in single mode with:
   - `agent: "codebase-explorer"`
   - `task`: the clarified functional request, including key terms, relevant areas of the codebase, and any context gathered during brainstorming
   - `agentScope: "project"`
   - `confirmProjectAgents: false`
   
   Do not present scope until exploration completes or the retry policy is exhausted.
8. Verify important claims from the exploration report by inspecting referenced files, symbols, or test files. Do not take the report on faith.
9. If the exploration produces no output, error output, or the agent result is marked as failed, retry exactly once. If the second attempt also fails, stop planning and present the user with explicit choices: retry manually or continue without exploration.
10. If during scope discussion the requirements change materially (the functional scope shifts, key terms change, or new code areas become relevant), the existing exploration is invalidated. Note the change and return to step 7 to produce a fresh report before renewed scope approval.

## C. Scope approval

Using the exploration evidence, present the proposed goal, in-scope behavior, non-goals, constraints and decisions, observable acceptance criteria, and unresolved questions. Continue discussion while questions remain. Otherwise require the user to reply exactly:

```text
approve scope
```

Casual agreement is not approval. If requirements change after approval, reopen this phase and obtain `approve scope` again.

After exact approval, choose a lowercase hyphenated slug. If `.pi/features/<slug>.md` exists, ask before replacing it. Otherwise create it with `Status: scope-approved` and this self-contained structure:

```markdown
# Feature: <name>

## Status
scope-approved

## Original request
<short request>

## Goal
<one paragraph>

## Scope
- included behavior

## Non-goals
- excluded behavior

## Constraints and decisions
- approved decision and why

## Acceptance criteria
- AC1: observable criterion

## Repository checks
- `<command>` - when to run it

## Implementation base
- Branch: pending
- Base SHA: pending

## Task graph
pending

## Integration log
- pending

## Review log
- pending
```

## D. Task decomposition and approval

Read the relevant implementation paths deeply enough and write task guidance that makes every task executable by an agent with no conversation context. The plan must cover every acceptance criterion and use stable IDs (`T1`, `T2`, ...). For each task, the `Work` field must give a context-free implementer:

- concrete starting files, code areas, or symbols to work with
- the exact behavioral change and observable result
- relevant edge cases, failure behavior, and data contracts
- explicit boundaries and prohibited scope expansion
- required test changes with exact checks

Keep details relevant rather than exhaustive: do not duplicate the feature document, prescribe line-by-line edits, or dictate mechanics unless approved constraints or existing architecture require them. Preserve the existing task schema, approval gates, and execution workflow.

For each task record:

```markdown
### T1: <title>
- Covers: AC1
- Depends on: none
- Parallel wave: 1
- Expected files: `path`, `path`
- Shared resources: none
- Work: exact implementation instructions
- Acceptance: exact expected behavior
- Checks: `<command>`
```

Validate before presenting it:

- every dependency ID exists and the graph has no cycles
- every task derives from approved scope and all acceptance criteria are covered
- tasks in one wave have no expected file overlap
- migrations, lockfiles, generated schemas, package manifests, central registries, and other shared state are serialized

Show task IDs/titles, dependencies, waves, file ownership, checks, and stable task-ID integration order. Require the exact reply:

```text
approve plan
```

Casual agreement is not approval. Requirement changes reopen scope; task changes require plan approval again. On exact approval, write the graph and per-task pending integration entries to the feature document and set `Status: plan-approved`.

After plan approval, do not rewrite approved scope or acceptance criteria unless the user explicitly reopens scope. During execution update only status and log sections.

## E. Git safety and setup

Before changing code:

1. Run `git status --porcelain`.
2. If unrelated changes exist, stop and ask how to proceed. Never stash, reset, clean, overwrite, commit, or include them automatically.
3. Record the full current SHA as the implementation base.
4. Create or switch to `pi-feature/<slug>` only after user confirmation if changing their current branch.
5. Record the integration branch and base SHA in the feature document. If the repository tracks `.pi/features/`, commit that document as the first workflow commit.

If this is not a git repository, explain that writable tasks must run sequentially without worktrees and ask whether to continue. Do not pretend parallel writes are isolated.

## F. Execute dependency waves

For each wave:

1. Select only tasks whose dependencies are integrated, and recheck file/shared-resource independence.
2. One ready task may run sequentially. For multiple independent writable tasks, create one sibling worktree and branch per task from the current integration HEAD.
3. Use branch `pi-feature/<slug>/<task-id-lowercase>` and sibling path `<parent>/.pi-worktrees/<repo-name>/<slug>/<task-id-lowercase>`; never nest worktrees in the repository.
4. Invoke the `subagent` tool using `feature-implementer`. For concurrent tasks use parallel mode with each task's distinct `cwd`; otherwise use single mode. Always set:

```json
{
  "agentScope": "project",
  "confirmProjectAgents": false
}
```

5. Give each worker only:
   - the absolute approved feature document path
   - its task ID and full task text
   - dependency commits already integrated
   - allowed/expected files
   - relevant acceptance criteria
   - exact checks
   - instructions to commit and return the required SHA/result contract
6. A blocked, failed, aborted, unknown-agent, non-zero-exit, model-error, or no-final-output result does not complete the task. Do not start dependents; clarify with the user when needed and rerun only that task.
7. Cherry-pick successful commits into the integration branch in stable task-ID order. On conflict, abort the cherry-pick and report exact conflicting files; never discard changes or choose one side wholesale.
8. Run combined checks after the wave, then update and commit the integration log.
9. Remove completed worktrees only after commits are safely integrated. Never force-remove one with uncommitted changes.

Sequential tasks still use `feature-implementer`, create a dedicated commit, and obey the same contract.

## G. Final verification

After every task is integrated:

- run every repository check recorded in the feature document
- inspect `git diff <base-sha>..HEAD --stat`
- verify each acceptance criterion has implementation and test evidence
- set feature status to `reviewing`

Do not review while required checks fail unless the failure is documented and explicitly accepted by the user.

## H. Review and one bounded fix pass

Invoke `feature-reviewer` once in the integration checkout with `agentScope: "project"` and `confirmProjectAgents: false`. Supply the absolute feature document path, base SHA, integration branch, final check results, and instruction to review `<base-sha>..HEAD`.

If approved, record the verdict and finish. If `changes-required`:

1. Present findings to the user.
2. Delegate all critical findings to `feature-implementer` as one focused fix task.
3. Apply warnings only when required by an acceptance criterion or explicitly approved by the user.
4. Run relevant checks and commit the fix.
5. Invoke `feature-reviewer` one final time.
6. If critical findings remain, stop and report them. Never start another automatic fix/review loop.

## I. Completion

Set status to `complete` only when every task is integrated, required checks pass or have explicit user acceptance, and no critical findings remain.

Return a concise summary with the feature document path, integration branch/base SHA, task commits, files changed, checks/outcomes, final verdict, and remaining warnings/follow-up work.

Never automatically merge to the user's main branch, push, open a pull request, delete the integration branch, reset, stash, or delete user work.
