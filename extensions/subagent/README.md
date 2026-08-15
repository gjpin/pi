# Subagent extension

Adapted from the subagent example shipped with
[`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent).
It runs delegated agents in isolated `pi --mode json -p --no-session` subprocesses.

## Capabilities

- Single, parallel (8 tasks maximum, 4 concurrent), and chained calls
- Agent-selected models and tool allowlists
- Per-task working directories, streaming progress, usage details, and abort propagation
- Parallel model-visible output capped at 50 KB per task

Worktree creation and git integration intentionally remain the parent workflow's responsibility.

## Trust

Project agents come from the nearest `.pi/agents/` directory and are repository-controlled prompts with the user's system permissions. Use `agentScope: "project"` only in repositories already approved by Pi's project trust gate. The feature workflow uses `confirmProjectAgents: false` only on that basis.

## Model setup

Authenticate, refresh the catalogs, and verify the required models:

```text
/login openrouter
/login openai-codex
```

```bash
pi update --models
pi --list-models deepseek-v4-flash
pi --list-models gpt-5.6
```

Required selectors:

```text
openai-codex/gpt-5.6-sol:medium
openrouter/deepseek/deepseek-v4-flash
openai-codex/gpt-5.6-luna:xhigh
```

If OpenAI API credentials are used instead of a ChatGPT/Codex subscription, change the two OpenAI selectors to `openai/...`; do not silently change providers.

If the OpenRouter model is absent after login and refresh, first verify that OpenRouter's catalog ID is `deepseek/deepseek-v4-flash`, then merge this minimal entry into `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "openrouter": {
      "models": [{ "id": "deepseek/deepseek-v4-flash" }]
    }
  }
}
```

Preserve any existing providers and models in that file. This intentionally does not invent context-window, output-limit, or pricing metadata. Do not fall back to the direct `deepseek` provider.

## Launch

From a target repository containing (or loading) the included `.pi/agents` and `.pi/prompts` resources:

```bash
pi \
  -e /Users/zero/src/_pi/extensions/subagent/index.ts \
  --model openai-codex/gpt-5.6-sol:medium \
  --models 'openai-codex/gpt-5.6-sol:medium,openrouter/deepseek/deepseek-v4-flash,openai-codex/gpt-5.6-luna:xhigh'
```

Then run:

```text
/feature <feature idea>
```

For initial development, run in `/Users/zero/src/_pi`. Global packaging is intentionally deferred.

## Tests

With Pi's packages available to Node's module resolver:

```bash
node --test extensions/subagent/*.test.ts
```

Tests do not invoke paid model APIs.
