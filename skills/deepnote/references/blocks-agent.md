# Agent Block

> Common block fields (`id`, `blockGroup`, `type`, `content`, `sortingKey`, `metadata`) are described in [SKILL.md](../SKILL.md).

## Agent Block (`agent`)

Agentic block that takes a user prompt, reads the full notebook context (including prior block outputs), calls an LLM, and autonomously adds new code and markdown blocks to the notebook.

The agent block uses AI SDK 7 and can connect to external MCP servers for additional tools.

**Metadata fields:**

| Field                  | Type     | Default  | Description                                       |
| ---------------------- | -------- | -------- | ------------------------------------------------- |
| `deepnote_agent_model` | `string` | `"auto"` | LLM model name (e.g. `gpt-6.1-sol`, `gpt-6-luna`) |
| `deepnote_mcp_servers` | `array`  | -        | Block-level MCP server configs (see below)        |

**MCP server config** (each entry in `deepnote_mcp_servers` or `project.settings.mcpServers`):

| Field     | Type                    | Required | Description                                      |
| --------- | ----------------------- | -------- | ------------------------------------------------ |
| `name`    | `string`                | yes      | Unique server identifier                         |
| `command` | `string`                | yes      | Command to spawn (stdio transport)               |
| `args`    | `string[]`              | no       | Command arguments                                |
| `env`     | `Record<string,string>` | no       | Environment variables; `${VAR}` refs process.env |

**Providers:**

Bare Claude ids such as `claude-opus-5-5` select Anthropic locally, matching Cloud's model naming.
Other bare model names select OpenAI. `auto`, Cloud's `default` sentinel, and an omitted model
use the local OpenAI default. Local execution also accepts a `provider:model` prefix.

For `auto`, the provider's model environment variable overrides the default: `gpt-6.1-sol` for
`openai`, `claude-opus-5-5` for `anthropic`. The `openai-compatible` provider requires an explicit
model or model environment variable. OpenRouter uses `anthropic/claude-opus-5.5` as its Opus 5.5 id.

Direct OpenAI access and GPT-6 models use Responses, including through `OPENAI_BASE_URL` proxies.
Other models on custom base URLs retain Chat Completions. Use `openai-compatible` and a model
with Chat Completions tool support for endpoints that only support that API.

For notebooks shared with Cloud, use `auto` or a bare id from Cloud's catalog, such as
`claude-opus-5-5`, `claude-sonnet-5-5`, `gpt-6-sol`, or `gpt-6-luna`. Cloud does not parse provider
prefixes and falls back to workspace settings for unsupported names. GPT-6.1 Sol is not in its
catalog as of October 8, 2026. `auto` uses workspace settings in Cloud; local keys and endpoints
do not configure Cloud.

| Provider id         | Package                     | Use for                                           |
| ------------------- | --------------------------- | ------------------------------------------------- |
| `openai`            | `@ai-sdk/openai`            | OpenAI (the default for `auto`)                   |
| `anthropic`         | `@ai-sdk/anthropic`         | Claude                                            |
| `openai-compatible` | `@ai-sdk/openai-compatible` | OpenRouter, Ollama, LiteLLM, vLLM, Together, Groq |

**Environment variables:**

| Variable                  | Provider            | Required | Description                                                    |
| ------------------------- | ------------------- | -------- | -------------------------------------------------------------- |
| `OPENAI_API_KEY`          | `openai`            | yes      | API key                                                        |
| `OPENAI_BASE_URL`         | `openai`            | no       | Custom endpoint; GPT-6 models require Responses                |
| `OPENAI_MODEL`            | `openai`            | no       | Model when the block says `auto`; otherwise the block wins     |
| `ANTHROPIC_API_KEY`       | `anthropic`         | yes      | API key                                                        |
| `ANTHROPIC_BASE_URL`      | `anthropic`         | no       | Custom endpoint                                                |
| `ANTHROPIC_MODEL`         | `anthropic`         | no       | Model when the block says `auto`; otherwise the block wins     |
| `DEEPNOTE_AGENT_API_KEY`  | `openai-compatible` | yes      | API key; falls back to `OPENAI_API_KEY`                        |
| `DEEPNOTE_AGENT_BASE_URL` | `openai-compatible` | yes      | Endpoint; falls back to `OPENAI_BASE_URL`                      |
| `DEEPNOTE_AGENT_MODEL`    | `openai-compatible` | no       | Model when the block says `auto`; falls back to `OPENAI_MODEL` |

**Built-in agent tools:**

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

You can run an agent block directly from the command line without creating a `.deepnote` file:

```bash
# Standalone (creates an in-memory notebook with just the agent block)
OPENAI_API_KEY=sk-... deepnote run --prompt "Write a hello world script"

# Appended to an existing notebook (runs all blocks, then the agent)
OPENAI_API_KEY=sk-... deepnote run my-project.deepnote --prompt "Analyze the data"
```

When database integrations are configured (via `integrations.yaml`), the agent is automatically made aware of them and can query databases using `deepnote-toolkit`.
