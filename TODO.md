i don't need to approve the plan phase, only the scope phase.
i don't need to approve this type of replies either, since they are plans:
example:
T3 is blocked because the approved agent matrices correctly invalidate seven older assertions in                             
 extensions/subagent/index.test.ts, but that file was not assigned to T3.

 Proposed plan amendment:

 - Add extensions/subagent/index.test.ts to T3’s expected/allowed files.
 - Update only its mocked parent resource catalog and child-resource assertions.
 - Keep all scope and acceptance criteria unchanged.

 This is a task-plan change, so reply exactly:

 ```text
   approve plan
 ```               
end of example

- skills per agent
- tasks should leave no doubt for implementer. they are less capable models. they should be fairly detailed (just enough, not too much).
- the scope document should be saved for future reference. every scope should be stored as a markdown file. and they should be use ID-feature (eg. 00001-adds-sso). it should be numbered like in the example, so that i have a order in the changes. store in under plans/ in the root of the project

- what is the difference between the scope and the plan phases?


red / green tdd
- subagent 1: make tests
- subagent 2: develop and pass tests

- implementer must always make tests



- rename extension from subagents to 



Red Team (Test Writers), write tests without seeing implementation. They define what the code should do based on specs/requirements only. Rewarded by test failures. A new test that passes immediately is suspicious as it means either the implementation already covers it (diminishing returns) or the test is tautological. Red's ideal outcome is a well-named test that fails, because that represents a gap between spec and implementation that didn't previously have a tripwire. Their proxy metric is "number of meaningful new failures introduced" and the barrier prevents them from writing tests pre-adapted to pass.

Green Team (Implementers), write implementation to pass tests without seeing the test code directly. They only see test results (pass/fail) and the spec. Rewarded by turning red tests green. Straightforward, but the barrier makes the reward structure honest. Without it, Green could satisfy the reward trivially by reading assertions and hard-coding. With it, Green has to actually close the gap between spec intent and code behavior, using error messages as noisy gradient signal rather than exact targets. Their reward is "tests that were failing now pass," and the only reliable strategy to get there is faithful implementation.

Refactor Team, improve code quality without changing behavior. They can see implementation but are constrained by tests passing. Rewarded by nothing changing (pretty unusual in this regard). Reward is that all tests stay green while code quality metrics improve. They're optimizing a secondary objective (readability, simplicity, modularity, etc.) under a hard constraint (behavioral equivalence). The spec barrier ensures they can't redefine "improvement" to include feature work. If you have any code quality tools, it makes sense to give the necessary skills to use them to this team.






create a command that allows the model+reasoning effort to be selected














 - Scope phase: decides what and why—goal, included/excluded behavior, constraints, acceptance criteria, and unresolved requirements. Gate: exact reply approve scope.
 - Plan phase: decides how work is divided and executed—tasks, dependencies, waves, file ownership, checks, and integration order. Gate: exact reply approve plan.

 Requirement changes reopen scope; task/decomposition changes only require plan reapproval.

 ### All workflow phases

 1. Preflight — validate model, repository, instructions, and checks.
 2. Brainstorm — clarify goals, behavior, alternatives, constraints, and risks.
 3. Scope approval — finalize requirements and create the feature document.
 4. Task decomposition and approval — produce and approve the task graph.
 5. Git safety and setup — verify cleanliness, record base SHA, create integration branch.
 6. Execute dependency waves — delegate tasks, integrate commits, run wave checks.
 7. Final verification — run repository checks and verify acceptance criteria.
 8. Review and one bounded fix pass — reviewer pass, optionally one fix/re-review cycle.
 9. Completion — mark complete and summarize commits, checks, files, and warnings.







/documentation

/fix

/explore





i believe the subagents created via @extensions/subagent/ do not have extensions. they should inherit the same extensions and skills as the parent agent, except for the subagent extension




https://github.com/dmtrKovalenko/fff
pi install npm:@ff-labs/pi-fff
https://github.com/1broseidon/cymbal
brew install 1broseidon/tap/cymbal



in the scope phase, the agent is asking me twice the same questions. they are repeated. that should NOT happen. 
example:
Clarification group:                                                                                                         

 1. Should missing or invalid configured extension/skill names make the subagent fail before model execution, rather than
    silently continue?
 2. Should agent frontmatter use repeatable YAML lists, e.g.:
    ```yaml
      extensions:
        - "@ff-labs/pi-fff:src"
      skills:
        - ponytail
    ```
 3. Should the four extensions listed apply identically to all three agents, including feature-reviewer?
 This materially changes the request, so prior inheritance assumptions are discarded.

 I’ll keep the subagent extension as an internal runtime dependency for cymbal; each agent’s tools: allowlist will still
 prevent access to subagent.

 Clarifications:

 1. Should an unknown or unavailable configured extension/skill fail before model execution, rather than be silently skipped?
 2. Should frontmatter use YAML lists?
    ```yaml
      extensions:
        - "@ff-labs/pi-fff:src"
      skills:
        - ponytail
    ```
 3. Should the same extensions and skills apply to all three agents, including feature-reviewer? 
end of example




 ASK QUESTIONS EXTENSION:
examples:
- Should the tool guidance be concise-but-equivalent as recommended, or must the entire SKILL.md content be embedded verbatim? 
-  1. Should an unknown or unavailable configured extension/skill fail before model execution, rather than be silently skipped?
 2. Should frontmatter use YAML lists?
    ```yaml
      extensions:
        - "@ff-labs/pi-fff:src"
      skills:
        - ponytail
    ```
 3. Should the same extensions and skills apply to all three agents, including feature-reviewer? 





docs:
- document how subagents are configured





why is the main agent sometimes



if an agent is already in a git branch that is default/main/master, then keep creating a new worktree as it's already the case. but if the agent is already in a different worktree, then treat it has the current workspace and don't create more worktrees.






✗ feature-implementer (project) [toolUse]
why does it show a red "x" when a subagent is still working? it should be yellow and something like "..."