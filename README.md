# Skills
- [grill-me](https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me)
- [to-issues](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-issues)
- [improve-codebase-architecture](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-issues)
- [to-prd](https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture)
- [write-a-skill](https://github.com/mattpocock/skills/tree/main/skills/productivity/write-a-skill)
- [flutter](https://github.com/flutter/skills)
- [dart](https://github.com/dart-lang/skills)
- [golang](https://github.com/samber/cc-skills-golang)

# Agents
## Prompts
### developer
Base: [tdd](https://github.com/mattpocock/skills/tree/main/skills/engineering/tdd)
```
@tdd is an agent skill. I need it converted to an agent, so that i can use it as a subagent. Try to match the new agent as close as possible to the skill. the agent will be called "developer". It should be language agnostic.
```

# Extensions
## Prompts
### subagent
Base: [subagent example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent)
```
The existing "subagent" Pi extension delegates tasks to specialized subagents with isolated context windows. In order to save context, the subagents should allow to specify which skills to load. The skills should be specified in the agents/*.md files. Only skills specified in the agent's file should be loaded.
```

### exa-contents
```
Create a Pi agent tool named exa-contents.
Use these 2 pages as reference for exa contents API:
- https://exa.ai/docs/reference/contents-api-guide-for-coding-agents
- https://exa.ai/docs/reference/contents-best-practices

Take into account the following requirements:
- Return the full page content as clean markdown (text) by default, unless explicitely asked for html
- Use highlights and make another query without highlights if not enough
- support for summary
- Use "maxAgeHours": 24 by default
- subpage crawling must be possible
- properly handle errors
```

### exa-search
```
Create a Pi agent tool named exa-search.
Use these 2 pages as reference for exa search API:
- https://exa.ai/docs/reference/search-api-guide-for-coding-agents
- https://exa.ai/docs/reference/search-best-practices

Take into account the following requirements:
- support different search methods (auto by default, but allow others)
- Use highlights and make another query without highlights if not enough
- Use "maxAgeHours": 24 by default
- properly handle errors
```
