# Feature: Detailed implementation tasks

## Status
complete

## Original request
Make `/feature` tasks detailed enough that lower-capability implementation agents can execute them without ambiguity, without burdening the orchestrator with unnecessary detail.

## Goal
Improve `/feature` task decomposition so lower-capability implementation agents receive concise, self-contained, unambiguous tasks while routine implementation choices remain with the implementer.

## Scope
- Strengthen `.pi/prompts/feature.md` task-writing guidance.
- Require the orchestrator to inspect relevant implementation paths before writing tasks.
- Require each task to identify concrete files, code areas, or symbols; required behavior and observable outcomes; relevant edge or error cases; boundaries; and exact test changes and checks.
- Tell the orchestrator to prescribe mechanics only when required by approved constraints or repository architecture.
- Add regression coverage for the new prompt requirements.

## Non-goals
- Runtime validation or rejection of task text.
- Changes to direct, manually authored `subagent` calls.
- Line-by-line implementation recipes or mandatory pseudocode.
- Repeating the complete feature document in every task.
- Changes to agent models or delegation behavior.

## Constraints and decisions
- Keep task detail proportional: include information needed to prevent guessing, but leave routine mechanics to the implementer.
- Use prompt guidance rather than heuristic validation because semantic clarity cannot be reliably validated in extension code.
- Preserve the existing task schema and workflow unless a minimal wording adjustment is needed.
- The current directory is not a Git repository; execution requires separate confirmation and writable tasks must run sequentially without worktrees.

## Acceptance criteria
- AC1: The `/feature` prompt requires tasks to be executable by an implementation agent with no planning-conversation context.
- AC2: The prompt requires concrete locations, behavior, relevant edge cases, boundaries, and test/check expectations in each task.
- AC3: The prompt explicitly avoids unnecessary implementation prescriptions and duplicated context.
- AC4: Automated tests verify the prompt contains and retains these task-detail requirements.
- AC5: Existing extension tests continue to pass.

## Repository checks
- `node --test extensions/subagent/*.test.ts` - run after implementation and during final verification from `/Users/zero/src/_pi`.

## Implementation base
- Branch: pending
- Base SHA: pending

## Task graph
### T1: Strengthen `/feature` implementation-task guidance
- Covers: AC1, AC2, AC3, AC4, AC5
- Depends on: none
- Parallel wave: 1
- Expected files: `.pi/prompts/feature.md`, `extensions/subagent/agents.test.ts`
- Shared resources: `/feature` prompt
- Work: Update task-decomposition guidance in `.pi/prompts/feature.md`. Require every task to give a context-free implementer concrete starting files, code areas, or symbols; the exact behavioral change and observable result; relevant edge cases, failure behavior, and data contracts; explicit boundaries and prohibited scope expansion; and required test changes with exact checks. Require details to be relevant rather than exhaustive: do not duplicate the feature document, prescribe line-by-line edits, or dictate mechanics unless approved constraints or existing architecture require them. Preserve the existing task schema, approval gates, and execution workflow. Extend the feature-resource test in `extensions/subagent/agents.test.ts` with assertions that protect these requirements.
- Acceptance: A future orchestrator cannot satisfy the prompt with a vague outcome-only `Work` entry. Tasks remain concise and leave routine implementation decisions to the implementer. Tests fail if the task-detail or proportionality guidance is removed, and all existing tests pass.
- Checks: `node --test extensions/subagent/*.test.ts` from `/Users/zero/src/_pi`

## Integration log
- T1: completed sequentially in place; commit unavailable because this is not a Git repository. Changed `.pi/prompts/feature.md` and `extensions/subagent/agents.test.ts`.
- Wave 1 combined check: `node --test extensions/subagent/*.test.ts` passed (11 tests) from `/Users/zero/src/_pi` with temporary resolver symlinks to Pi's installed packages; symlinks were removed after the check.
- Final verification: AC1-AC3 are implemented in the task-decomposition prompt; AC4 is covered by feature-resource assertions; AC5 passed. Git diff/stat unavailable because this is not a Git repository.
- Bounded review fix: completed sequentially in place with no commit available; expanded `extensions/subagent/agents.test.ts` to assert every approved task-detail and proportionality requirement.
- Post-fix check: `node --test extensions/subagent/*.test.ts` passed (11 tests) with temporary resolver symlinks removed afterward.

## Review log
- Initial review: changes-required. Critical finding: regression assertions did not protect every approved task-detail requirement.
- Final review: approved. All acceptance criteria covered; no critical findings, warnings, or suggestions.
