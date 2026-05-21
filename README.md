# Packages
- [pi-subagents](https://github.com/nicobailon/pi-subagents)
- [pi-intercom](https://github.com/nicobailon/pi-intercom)
- [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter)

# Agents
## Prompts
### developer
```

```

# Skills
- [grill-me](https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me)
- [to-issues](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-issues)
- [improve-codebase-architecture](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-issues)
- [to-prd](https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture)
- [write-a-skill](https://github.com/mattpocock/skills/tree/main/skills/productivity/write-a-skill)
- [tdd](https://github.com/mattpocock/skills/tree/main/skills/engineering/tdd)

# Extensions
## Prompts
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
