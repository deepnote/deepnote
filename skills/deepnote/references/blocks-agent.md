# Agent Block

> Common block fields (`id`, `blockGroup`, `type`, `content`, `sortingKey`, `metadata`) are described in [SKILL.md](../SKILL.md).

## Agent Block (`agent`)

Agentic block that takes a user prompt, reads the full notebook context (including prior block outputs), calls an LLM, and autonomously adds new code and markdown blocks to the notebook.

The agent block uses the OpenAI Agents SDK and can connect to external MCP servers for additional tools.

**Metadata fields:**

| Field                  | Type     | Default  | Description                                   |
| ---------------------- | -------- | -------- | --------------------------------------------- |
| `deepnote_agent_model` | `string` | `"auto"` | LLM model name (e.g. `gpt-4o`, `gpt-4o-mini`) |
| `deepnote_mcp_servers` | `array`  | -        | Block-level MCP server configs (see below)    |

**MCP server config** (each entry in `deepnote_mcp_servers` or `project.settings.mcpServers`):

| Field     | Type                    | Required | Description                                      |
| --------- | ----------------------- | -------- | ------------------------------------------------ |
| `name`    | `string`                | yes      | Unique server identifier                         |
| `command` | `string`                | yes      | Command to spawn (stdio transport)               |
| `args`    | `string[]`              | no       | Command arguments                                |
| `env`     | `Record<string,string>` | no       | Environment variables; `${VAR}` refs process.env |

**Environment variables:**

| Variable          | Required | Description                                               |
| ----------------- | -------- | --------------------------------------------------------- |
| `OPENAI_API_KEY`  | yes      | API key for the LLM provider                              |
| `OPENAI_BASE_URL` | no       | Base URL for non-OpenAI providers (Ollama, LiteLLM, etc)  |
| `OPENAI_MODEL`    | no       | Default model name (overridden by `deepnote_agent_model`) |

**Built-in agent tools:**

- `add_code_block` - Adds a Python code block after the agent block and executes it. Returns output.
- `add_markdown_block` - Adds a markdown block after the agent block for explanations.

```yaml
- id: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
  blockGroup: b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4
  type: agent
  content: "Analyze the data loaded above and create a visualization of the top 10 categories"
  metadata:
    deepnote_agent_model: gpt-4o
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
