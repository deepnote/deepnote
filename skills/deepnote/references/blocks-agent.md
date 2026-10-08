# Agent Block

> Common block fields (`id`, `blockGroup`, `type`, `content`, `sortingKey`, `metadata`) are described in [SKILL.md](../SKILL.md).

## Agent Block (`agent`)

An agent block follows your prompt, reads prior notebook outputs, and adds code and Markdown
blocks. It can connect to MCP servers for more tools.

**Metadata fields:**

| Field                  | Type     | Default  | Description                                            |
| ---------------------- | -------- | -------- | ------------------------------------------------------ |
| `deepnote_agent_model` | `string` | `"auto"` | Model ID (e.g. `claude-opus-5-5`); see providers below |
| `deepnote_mcp_servers` | `array`  | -        | Block-level MCP server configs (see below)             |

**MCP server config** (each entry in `deepnote_mcp_servers` or `project.settings.mcpServers`):

| Field     | Type                    | Required | Description                                      |
| --------- | ----------------------- | -------- | ------------------------------------------------ |
| `name`    | `string`                | yes      | Unique server identifier                         |
| `command` | `string`                | yes      | Command to spawn (stdio transport)               |
| `args`    | `string[]`              | no       | Command arguments                                |
| `env`     | `Record<string,string>` | no       | Environment variables; `${VAR}` refs process.env |

### Providers

Locally, model IDs starting with `claude-` select Anthropic; other names select OpenAI.
Use `provider:model` to choose a provider explicitly, such as `anthropic:auto` or
`openai-compatible:llama4`.

Without a provider prefix, `auto` or an omitted model selects OpenAI. An explicit model overrides
the provider's model environment variable; otherwise that variable or the default below is used.

| Provider            | Default model     | API key                  | Model override         |
| ------------------- | ----------------- | ------------------------ | ---------------------- |
| `openai`            | `gpt-6.1-sol`     | `OPENAI_API_KEY`         | `OPENAI_MODEL`         |
| `anthropic`         | `claude-opus-5-5` | `ANTHROPIC_API_KEY`      | `ANTHROPIC_MODEL`      |
| `openai-compatible` | Must be set       | `DEEPNOTE_AGENT_API_KEY` | `DEEPNOTE_AGENT_MODEL` |

Use `OPENAI_BASE_URL` (including `/v1`) or `ANTHROPIC_BASE_URL` (with or without `/v1`) to override
a provider's endpoint. The `openai` provider always uses the Responses API, so its endpoint must
support it.

Other endpoints, such as OpenRouter, Ollama, and LiteLLM, use the `openai-compatible` provider. It
uses Chat Completions and needs a key, endpoint (`DEEPNOTE_AGENT_BASE_URL`), and a model that
supports tool calling. Set the model in the block or use `openai-compatible:auto` with
`DEEPNOTE_AGENT_MODEL`. OpenRouter uses its own model IDs, such as
`openai-compatible:anthropic/claude-opus-5.5`.

### Sharing notebooks with Cloud

Use `auto` or a supported model ID without a provider prefix, such as `claude-opus-5-5`,
`claude-sonnet-5-5`, `gpt-6-sol`, or `gpt-6-luna`. Unsupported names, including provider prefixes,
use workspace settings instead.

`auto` uses workspace settings in Cloud and the defaults above locally. Local keys and endpoints
do not configure Cloud.

### Built-in agent tools

- `add_code_block` - Adds a Python code block after the agent block and executes it. Returns output.
- `add_markdown_block` - Adds a markdown block after the agent block for explanations.

```yaml
- id: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
  blockGroup: b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4
  type: agent
  content: "Analyze the data loaded above and create a visualization of the top 10 categories"
  metadata:
    deepnote_agent_model: claude-opus-5-5
    deepnote_mcp_servers:
      - name: filesystem
        command: npx
        args: ["-y", "@modelcontextprotocol/server-filesystem", "./data"]
  sortingKey: a2
```

## Using via CLI `--prompt` flag

`--prompt` creates an agent block using OpenAI with `OPENAI_MODEL`, or `gpt-6.1-sol` if unset:

```bash
# Standalone (creates an in-memory notebook with just the agent block)
OPENAI_API_KEY=sk-... deepnote run --prompt "Write a hello world script"

# Appended to an existing notebook (runs all blocks, then the agent)
OPENAI_API_KEY=sk-... deepnote run my-project.deepnote --prompt "Analyze the data"
```

The agent can query databases configured in `integrations.yaml` using `deepnote-toolkit`.
