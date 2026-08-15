# Feature: Per-agent subagent resources

## Status
plan-approved

## Original request
Let each subagent explicitly enable parent-loaded extensions and skills, and move Cymbal into an independent extension.

## Goal
Allow every subagent definition to select an exact, validated subset of extensions and skills already loaded by the parent, while preserving tool allowlists and providing Cymbal as an independent, safely guided extension.

## Scope
- Add YAML-list `extensions:` and `skills:` fields to agent frontmatter.
- Resolve extension selectors against parent-loaded extension provenance and skills by exact parent-loaded name.
- Fail before child spawn when resource configuration is malformed, missing, or ambiguous.
- Spawn children with extension and skill discovery disabled, then explicitly load only resolved configured paths.
- Preserve each agent's `tools:` allowlist.
- Extract Cymbal into `extensions/cymbal/index.ts` with concise equivalent operating guidance, command restrictions, cancellation, and output truncation.
- Configure `codebase-explorer` with extensions `@ff-labs/pi-fff:src` and `cymbal`, and no skills.
- Configure `feature-implementer` with extensions `@ff-labs/pi-fff:src`, `DietrichGebert/ponytail:pi-extension`, `exa-contents`, `exa-search`, and `cymbal`; skill `ponytail`; and active tools `exa_contents` and `exa_search` in addition to its existing allowlist.
- Configure `feature-reviewer` with extensions `@ff-labs/pi-fff:src` and `cymbal`, and skill `ponytail-review`.
- Keep `check-workflow-deps` in the subagent extension and make it verify FFF, the Cymbal CLI, and the independently loaded Cymbal tool.
- Update automated tests and launch/resource documentation.

## Non-goals
- Automatically inherit resources from the parent.
- Install, update, or independently rediscover unavailable resources.
- Modify duplicate user-global agents under `~/.pi/agent/agents/`.
- Embed the complete Cymbal skill text.
- Give child agents access to the `subagent` tool unless a future agent explicitly configures and allowlists it.

## Constraints and decisions
- Extension selectors refer only to extensions already loaded in the parent; skill selectors refer to parent-loaded skills by exact name. This preserves explicit per-agent configuration without installing or rediscovering resources.
- Pi-style package resource selectors such as `@ff-labs/pi-fff:src` and `DietrichGebert/ponytail:pi-extension`, plus unique local names such as `exa-search`, are supported; ambiguous aliases fail rather than selecting arbitrarily.
- Children use `--no-extensions --no-skills` plus explicit repeatable resource flags so unconfigured resources cannot leak in through discovery.
- Tool availability remains the intersection of loaded extensions and each agent's `tools:` allowlist.
- Cymbal is an independent extension and must be loaded in the parent launch as well as selected by agents that use it.
- Cymbal guidance is concise but behaviorally equivalent to the approved skill guidance: investigation loop, command selection, pivot and stop rules, and safety restrictions without copying the full skill.
- Existing read-only boundaries for explorer and reviewer remain unchanged.

## Acceptance criteria
- AC1: YAML extension and skill lists are parsed into agent configuration, while invalid field shapes produce an explicit error before a child is spawned.
- AC2: Missing or ambiguous extension selectors and missing skill names fail before any child process or model execution.
- AC3: Every child invocation disables extension and skill discovery and explicitly loads only the configured, resolved extension and skill paths while preserving the agent tool allowlist.
- AC4: The three checked-in agents contain the approved resource matrix; the implementer can actively use `exa_contents` and `exa_search`; explorer and reviewer remain read-only.
- AC5: The subagent extension no longer registers Cymbal, and the independent Cymbal extension provides the existing read-only command allowlist, cancellation, error propagation, 50 KB truncation, and concise operating guidance.
- AC6: `check-workflow-deps` verifies FFF override provenance, Cymbal CLI availability, and that the independent Cymbal tool is active.
- AC7: Automated tests cover frontmatter parsing, selector resolution, exact child arguments, pre-spawn failures, independent Cymbal behavior, and checked-in agent configuration.
- AC8: Documentation explains per-agent resource configuration and launches the parent with both subagent and Cymbal extensions.

## Repository checks
- `node --test extensions/subagent/*.test.ts extensions/cymbal/*.test.ts` - run after relevant tasks, after integration waves, and during final verification

## Implementation base
- Branch: `pi-feature/per-agent-subagent-resources`
- Base SHA: `4b1fc2492eb341d7dd3a47fc000a589e12286aac`

## Task graph

### T1: Extract the independent Cymbal extension
- Covers: AC5, AC6, AC7
- Depends on: none
- Parallel wave: 1
- Expected files: `extensions/subagent/index.ts`, `extensions/subagent/index.test.ts`, `extensions/cymbal/index.ts`, `extensions/cymbal/index.test.ts`
- Shared resources: subagent tool registry
- Work: Move the read-only Cymbal tool and command allowlist out of the subagent extension. Preserve cancellation, non-zero error propagation, argument forwarding, and 50 KB truncation. Add concise `promptSnippet` and `promptGuidelines` covering the investigation loop, command selection, pivot and stop rules, and safety restrictions. Keep `check-workflow-deps` in the subagent extension, but require both the Cymbal CLI and independently registered active `cymbal` tool. Do not copy the complete skill or alter unrelated subagent behavior.
- Acceptance: The subagent extension registers only its own workflow tools; loading the independent extension provides Cymbal with equivalent safety behavior and sufficient operating guidance.
- Checks: `node --test extensions/subagent/*.test.ts extensions/cymbal/*.test.ts`

### T2: Add strict per-agent resource selection
- Covers: AC1, AC2, AC3, AC7
- Depends on: T1
- Parallel wave: 2
- Expected files: `extensions/subagent/agents.ts`, `extensions/subagent/index.ts`, `extensions/subagent/index.test.ts`, `extensions/subagent/resources.test.ts`
- Shared resources: agent configuration and child process arguments
- Work: Parse optional YAML-array `extensions` and `skills` fields without weakening existing frontmatter validation. Build the available extension catalog from parent-loaded tool and extension-command provenance so command-only extensions such as Ponytail are included; build the skill catalog from parent-loaded skill commands. Support Pi-style package selectors and unique local extension names. Reject malformed, missing, or ambiguous entries before spawning any child, including prevalidating every requested agent in parallel and chain calls. Spawn with `--no-extensions --no-skills`, repeat explicit `--extension` and `--skill` paths, preserve model, tool, and system-prompt arguments, and never add the subagent extension implicitly. Absent lists mean no extension or skill resources. Do not install or scan for unavailable resources.
- Acceptance: Child arguments contain exactly the selected resource paths, and every invalid resource case returns an explicit failure with zero spawn calls.
- Checks: `node --test extensions/subagent/*.test.ts extensions/cymbal/*.test.ts`

### T3: Configure roles and document usage
- Covers: AC4, AC7, AC8
- Depends on: T2
- Parallel wave: 3
- Expected files: `.pi/agents/codebase-explorer.md`, `.pi/agents/feature-implementer.md`, `.pi/agents/feature-reviewer.md`, `extensions/subagent/agents.test.ts`, `extensions/subagent/index.test.ts`, `extensions/subagent/README.md`
- Shared resources: checked-in agent definitions, subagent test resource fixtures, and launch documentation
- Work: Add the approved YAML resource matrix to all three project agents. Add `exa_contents` and `exa_search` only to the implementer tool allowlist; preserve explorer and reviewer read-only boundaries and existing role contracts. Test exact checked-in configuration and update existing subagent test resource fixtures and child-argument assertions to reflect the approved matrices. Document list syntax, parent-loaded resolution, pre-spawn failures, exact child isolation, independent Cymbal loading, and a launch command containing both extension paths. Do not modify user-global agent copies.
- Acceptance: All checked-in roles expose exactly the approved resources and tools, and documentation is sufficient to launch and configure the workflow.
- Checks: `node --test extensions/subagent/*.test.ts extensions/cymbal/*.test.ts`

## Integration log
- T1: integrated as `98537aaf4722247a1386461087a25aaf59c0647d`; combined check passed (54/54 tests).
- T2: integrated as `f36c437f6a51cf2b2d51c9892d87cfae1783892b`; combined check passed (89/89 tests).
- T3: pending

## Review log
- pending
