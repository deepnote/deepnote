---
title: Running agent blocks locally
description: Run Deepnote agent blocks on your own machine with Claude, OpenAI or any OpenAI-compatible endpoint such as OpenRouter, Ollama or LiteLLM, and give them extra tools through MCP servers
noIndex: false
noContent: false
---

An agent block holds a prompt instead of code. When it runs, an AI agent reads the notebook so far
(its code, outputs and data), writes and runs Python blocks, checks the results, and explains what it
found in Markdown. In Deepnote Cloud the agent uses your workspace's [AI settings](/docs/deepnote-agent),
unless the block names a model Deepnote supports (see
[Notebooks shared with Deepnote Cloud](#notebooks-shared-with-deepnote-cloud)).
On your own machine, the [Deepnote CLI](/docs/deepnote-cli) runs the same agent block with the model
provider you choose: Anthropic, OpenAI, or any OpenAI-compatible endpoint, including local models.

## Run an agent block

Ask a question about a notebook from the terminal. The CLI runs the notebook, then adds an agent
block with your prompt at the end:

```bash
OPENAI_API_KEY=sk-... deepnote run sales.deepnote --prompt "Which region grew fastest last quarter, and why?"
```

Or start from nothing. The agent gets an empty notebook and builds it:

```bash
OPENAI_API_KEY=sk-... deepnote run --prompt "Download the latest Python release notes and summarize the new features"
```

`--prompt` uses OpenAI. To pick another provider, put an agent block in the `.deepnote` file and
choose its model there, as below; `deepnote run sales.deepnote` then runs it like any other block.

## Choose the model

An agent block's `deepnote_agent_model` field selects the model:

```yaml
- id: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
  blockGroup: b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4
  type: agent
  content: Analyze the data loaded above and chart the top 10 categories
  metadata:
    deepnote_agent_model: claude-opus-5-5
  sortingKey: a2
```

- A model whose name starts with `claude-` uses Anthropic; any other name uses OpenAI.
- `provider:model` picks the provider explicitly, for example `anthropic:auto` or
  `openai-compatible:<model>`.
- `auto`, or no model at all, uses OpenAI's default.

| Provider            | Default model     | API key                  | Choose the model with  | Endpoint override                    |
| ------------------- | ----------------- | ------------------------ | ---------------------- | ------------------------------------ |
| `openai`            | `gpt-6.1-sol`     | `OPENAI_API_KEY`         | `OPENAI_MODEL`         | `OPENAI_BASE_URL`                    |
| `anthropic`         | `claude-opus-5-5` | `ANTHROPIC_API_KEY`      | `ANTHROPIC_MODEL`      | `ANTHROPIC_BASE_URL`                 |
| `openai-compatible` | must be set       | `DEEPNOTE_AGENT_API_KEY` | `DEEPNOTE_AGENT_MODEL` | `DEEPNOTE_AGENT_BASE_URL` (required) |

A model named in the block takes precedence over the environment variable. The CLI also reads these
variables from a `.env` file next to the notebook, so keys stay out of your shell history.

### Use a gateway, a proxy or a local model

- **A company proxy or gateway** for OpenAI or Anthropic: set `OPENAI_BASE_URL` (including `/v1`) or
  `ANTHROPIC_BASE_URL`. The `openai` provider uses the Responses API, so the endpoint must support it.
- **OpenRouter, Ollama, LiteLLM and other OpenAI-compatible endpoints**: use the `openai-compatible`
  provider. It uses Chat Completions and needs a model that supports tool calling.

```bash
# Ollama on this machine
export DEEPNOTE_AGENT_BASE_URL=http://localhost:11434/v1
export DEEPNOTE_AGENT_API_KEY=ollama
export DEEPNOTE_AGENT_MODEL=<a-model-with-tool-calling>
deepnote run analysis.deepnote   # with deepnote_agent_model: openai-compatible:auto
```

On OpenRouter, use its model ids, such as `openai-compatible:anthropic/claude-opus-5.5`.

## Give the agent more tools

Besides adding code and Markdown blocks, an agent can use tools from
[MCP servers](https://modelcontextprotocol.io/). Add them to the block as below, or to
`project.settings.mcpServers`, in the same shape, to share them between all agent blocks:

```yaml
metadata:
  deepnote_agent_model: claude-opus-5-5
  deepnote_mcp_servers:
    - name: filesystem
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "./data"]
```

Each server is started as a local process; `env` passes environment variables to it, with `${VAR}`
taken from your environment. The agent can also query the databases configured for the notebook in
`.deepnote.env.yaml`.

## Notebooks shared with Deepnote Cloud

The same `.deepnote` file runs in Deepnote Cloud, where the agent uses your workspace's AI settings
instead of your local keys. To keep a block's model choice working in both places, use `auto` or a
model id without a provider prefix that Deepnote supports, such as `claude-opus-5-5`,
`claude-sonnet-5-5`, `gpt-6.1-sol` or `gpt-6-luna`. Prefixed or unsupported models fall back to the
workspace settings in Cloud.

## In VS Code and Cursor

The [Deepnote extension](/docs/vscode-extension) runs agent blocks too: use **Add Agent Block**,
write a prompt and run it. The extension asks for an OpenAI API key the first time and stores it in
the editor's secret storage; **Deepnote: Set OpenAI API Key** and **Deepnote: Clear OpenAI API Key**
change it. The extension runs agent blocks with OpenAI models only. It reads `OPENAI_BASE_URL` from
the editor's environment, and `OPENAI_MODEL` when the block's model is `auto`.

## Related

- [Deepnote Agent](/docs/deepnote-agent): the agent in Deepnote Cloud
- [Custom AI models](/docs/ai-custom-models): use your own models in Deepnote Cloud
- [Deepnote CLI](/docs/deepnote-cli) and [Deepnote format](/docs/deepnote-format)
