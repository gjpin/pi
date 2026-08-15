# Feature: Token-efficient codebase exploration

## Status
reviewing

## Original request
Use FFF, Cymbal, and a cheap specialized subagent to reduce tokens spent exploring codebases for functional feature requests.

## Goal
Reduce expensive planner exploration for functional feature requests by automatically delegating focused, read-only codebase discovery to a cheap specialized agent using FFF and Cymbal, while preserving the main planner as the authority for requirements and scope.

## Scope
- Add a project `codebase-explorer` agent using `openrouter/deepseek/deepseek-v4-flash`.
- Run exploration after necessary functional clarification and before presenting formal scope.
- Give the explorer the clarified request and repository working directory.
- Require FFF to own `find` and `grep` in `override` mode.
- Require an executable Cymbal installation.
- Check both dependencies during `/feature` preflight and provide actionable failure instructions.
- Ensure spawned role agents run with `PI_FFF_MODE=override`.
- Use Cymbal for semantic navigation and FFF for file/text discovery.
- Fall back to FFF when Cymbal cannot provide semantic coverage, explicitly reporting reduced coverage.
- Return a bounded evidence packet covering relevant paths, symbols, flows, patterns, tests, checks, risks, and unknowns.
- Retry a failed exploration once automatically; after the second failure, stop and offer explicit retry or continuation without exploration.
- Require fresh exploration if materially changed requirements invalidate the earlier report.
- Add role-appropriate FFF/Cymbal guidance to implementer and reviewer agents.
- Preserve existing subagent token and cost reporting.

## Non-goals
- Automatically installing or updating FFF or Cymbal.
- Pinning or enforcing dependency versions.
- Guaranteeing a specific percentage of token savings.
- Adding a nondeterministic model benchmark.
- Replacing the planner's requirement, scope, or architecture decisions.
- Treating Cymbal relationships as compiler-grade semantic analysis.
- Adding another model or provider.
- Automatically delegating every individual search.
- Vendoring FFF or Cymbal.

## Constraints and decisions
- Accept any installed working dependency versions.
- The explorer is read-only and cannot edit or write files.
- Its report is limited to approximately 800 words.
- Important explorer claims must be verified by the planner before scope approval.
- Missing dependencies or incorrect FFF mode stop preflight.
- Cymbal parse/index limitations do not fail exploration if FFF can continue.
- No silent expensive parent-led fallback after repeated explorer failure.
- Existing project trust and agent-scope protections remain unchanged.

## Acceptance criteria
- AC1: `/feature` preflight detects whether Cymbal is executable and whether active `find` and `grep` are FFF overrides; failures stop the workflow with remediation instructions.
- AC2: After focused requirement clarification, `/feature` automatically invokes `codebase-explorer` before presenting scope, using the clarified functional request.
- AC3: `codebase-explorer` is read-only, uses DeepSeek V4 Flash, prefers Cymbal semantic commands and FFF-backed search, and returns the approved bounded evidence structure.
- AC4: Cymbal semantic failure or insufficient language coverage causes an explicit FFF-only fallback rather than workflow failure.
- AC5: Explorer failure triggers exactly one automatic retry; a second failure stops planning and offers explicit retry or continuation without exploration.
- AC6: Material requirement changes invalidate the earlier exploration and require a fresh report before renewed scope approval.
- AC7: Explorer, implementer, and reviewer subprocesses receive FFF override mode; implementer and reviewer instructions contain appropriate Cymbal/FFF guidance without weakening their existing contracts.
- AC8: Existing token/cost reporting remains visible for explorer calls.
- AC9: Automated tests cover dependency detection, subprocess mode propagation, explorer discovery/configuration, prompt routing, fallback instructions, and retry policy.
- AC10: Existing repository tests continue to pass.

## Repository checks
- `node --test extensions/subagent/*.test.ts` - run after each implementation wave and during final verification.

## Implementation base
- Branch: `pi-feature/token-efficient-codebase-exploration`
- Base SHA: `c86bff1d8adb89809f6c1b9324ad465cf3c8440c`

## Task graph
### T1: Enforce exploration dependencies and subprocess mode
- Covers: AC1, AC7, AC8, AC9, AC10
- Depends on: none
- Parallel wave: 1
- Expected files: `extensions/subagent/index.ts`, `extensions/subagent/index.test.ts`, `extensions/subagent/README.md`
- Shared resources: subagent tool registration and process spawning
- Work: Register a read-only workflow dependency-check tool that verifies active `find` and `grep` come from FFF in override mode and executes `cymbal version`. Return success details or fail with actionable install/configuration guidance; never install or modify dependencies. Update subprocess spawning to preserve the current environment while forcing `PI_FFF_MODE=override` for explorer, implementer, and reviewer processes. Keep existing usage collection and rendering unchanged. Document required FFF/Cymbal setup and launch behavior. Add tests for successful and failed dependency checks, inactive/non-FFF tools, Cymbal command failure, environment propagation, and preserved usage reporting. Do not add version pinning or dependency installation.
- Acceptance: Dependency failures stop when the check tool is called, successful checks identify both dependencies, all workflow-role children receive override mode, and existing subagent behavior remains intact.
- Checks: `node --test extensions/subagent/index.test.ts`

### T2: Add the explorer role and automatic planning workflow
- Covers: AC2, AC3, AC4, AC5, AC6, AC7, AC9, AC10
- Depends on: none
- Parallel wave: 1
- Expected files: `.pi/agents/codebase-explorer.md`, `.pi/agents/feature-implementer.md`, `.pi/agents/feature-reviewer.md`, `.pi/prompts/feature.md`, `extensions/subagent/agents.test.ts`
- Shared resources: feature workflow prompt and project-agent definitions
- Work: Add a read-only `codebase-explorer` using `openrouter/deepseek/deepseek-v4-flash` with only navigation-capable tools. Its context-free instructions must prefer Cymbal for structure/symbol/call/impact navigation and FFF-backed `find`/`grep` for file/text discovery; if Cymbal cannot provide semantic coverage, continue with FFF and label the report as reduced coverage. Require an approximately 800-word evidence packet containing repository shape, relevant paths/symbols, flow, reusable patterns, tests/checks, risks, unknowns, and concrete evidence without finalizing scope. Update `/feature` to call the dependency check during preflight, clarify functional ambiguity before invoking the explorer, invoke it automatically with project scope and the clarified request before scope presentation, verify important claims, retry one failed/no-output exploration exactly once, and then stop with explicit retry/continue choices. Material requirement changes must invalidate and rerun exploration. Add concise FFF/Cymbal navigation guidance to implementer and reviewer without changing their existing result contracts or reviewer write restrictions. Extend resource tests for model/tool restrictions, report contract, routing order, fallback, retry limit, invalidation, and role guidance.
- Acceptance: The approved workflow ordering and failure policy are explicit and tested; the explorer is discoverable, read-only, correctly modeled, and produces the bounded evidence contract; existing role contracts remain valid.
- Checks: `node --test extensions/subagent/agents.test.ts`

## Integration log
- T1: integrated as `681b75df8e1ecda31f99a7d7133aac3b8a2637c4` (worker `c341e771ab127325a3cc9ccbab2705156753d0ba`); task and combined checks passed.
- T2: integrated as `ea8367112c743ea57b6c69fa335a18aee7a544a7` (worker `453b0776a8f4d3a5444a5c33ae6e8af98fa7012c`); task and combined checks passed.
- Wave 1: `node --test extensions/subagent/*.test.ts` passed, 27 tests. Task branches used the user-approved `pi-feature-task/<slug>/<task-id>` prefix because Git cannot store `pi-feature/<slug>` and nested `pi-feature/<slug>/<task-id>` refs simultaneously.
- T3 review fix: integrated as `bcda0a1fdcf1a62c6efc10910645f9e04e7307b9`, corrected by `c789d9fbb84632ff60c0ab9165dd7b8e35b110bf` and `e21bd5e8346e46990140837176da81838f36b36c`; `node --test extensions/subagent/*.test.ts` passed, 51 tests.

## Review log
- Initial review: changes-required. Critical findings covered dependency enforcement, FFF provenance, explorer write access, and invalid Cymbal guidance.
- Bounded fix pass: completed in `bcda0a1fdcf1a62c6efc10910645f9e04e7307b9`, `c789d9fbb84632ff60c0ab9165dd7b8e35b110bf`, and `e21bd5e8346e46990140837176da81838f36b36c`.
- Final review: pending.
