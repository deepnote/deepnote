# @deepnote/runtime-core

Core runtime for executing Deepnote projects.

This project is under active development and is not ready for use. Expect breaking changes.

## Installation

```bash
npm install @deepnote/runtime-core
```

## Prerequisites

Node.js 22.14.0 or later is required. Agent blocks use AI SDK 7 and its matching provider packages.

You must have `deepnote-toolkit` with the `server` extra installed in your Python environment:

```bash
pip install "deepnote-toolkit[server]"
```

## Usage

```typescript
import { ExecutionEngine } from "@deepnote/runtime-core";

const engine = new ExecutionEngine({
  // Python executable, venv directory, or command in PATH (for example: 'python3')
  pythonEnv: "python",
  workingDirectory: "/path/to/project",
});

try {
  await engine.start();

  const summary = await engine.runFile("./my-project.deepnote", {
    onBlockStart: (block, index, total) => {
      console.log(`Running [${index + 1}/${total}] ${block.type}...`);
    },
    onBlockDone: (result) => {
      console.log(result.success ? "ok" : "failed");
    },
  });

  console.log(
    `Executed ${summary.executedBlocks}/${summary.totalBlocks} blocks in ${summary.totalDurationMs}ms`,
  );
} finally {
  await engine.stop();
}
```

## Runtime config

`ExecutionEngine` accepts:

- `pythonEnv: string` - Python executable or environment path used to launch `deepnote-toolkit`
- `workingDirectory: string` - Working directory for execution
- `serverPort?: number` - Optional server port (auto-assigned when omitted)

## Execution options

`runFile(filePath, options)` and `runProject(file, options)` support:

- Notebook / block filtering: `notebookName`, `blockId`, `blockIds`
- Input injection before execution: `inputs`
- Database integration metadata for agent block awareness: `integrations`
- Cancellation of agent blocks: `signal` — code and SQL blocks still run to completion, and an aborted agent is reported as a failed block rather than a rejection
- Callbacks: `onBlockStart`, `onBlockDone`, `onOutput`, `onAgentEvent`, `onServerStarting`, `onServerReady`

## Agent block providers

Set `metadata.deepnote_agent_model` to a model ID. Names starting with `claude-` select Anthropic;
other names select OpenAI. For local runs, use `provider:model` to choose a provider explicitly,
such as `anthropic:auto` or `openai-compatible:llama4`.

Without a provider prefix, `auto` or an omitted model selects OpenAI. An explicit model overrides
the provider's model environment variable; otherwise that variable or the default below is used.

| Provider            | Default model                                                                     | API key                  | Model override         |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------ | ---------------------- |
| `openai`            | [`gpt-6.1-sol`](https://developers.openai.com/api/docs/models/gpt-6.1-sol)        | `OPENAI_API_KEY`         | `OPENAI_MODEL`         |
| `anthropic`         | [`claude-opus-5-5`](https://platform.claude.com/docs/en/models/opus-5-5/overview) | `ANTHROPIC_API_KEY`      | `ANTHROPIC_MODEL`      |
| `openai-compatible` | Must be set                                                                       | `DEEPNOTE_AGENT_API_KEY` | `DEEPNOTE_AGENT_MODEL` |

Callers that pass `apiKey` themselves can look up the variable a provider falls back to with
`getAgentApiKeyEnvVar(parseAgentModel(spec).providerId)`.

### Custom endpoints

Use `OPENAI_BASE_URL` (including `/v1`) or `ANTHROPIC_BASE_URL` (with or without `/v1`) to override a
provider's endpoint. The `openai` provider always uses the Responses API, so its endpoint must
support it.

Other endpoints, such as OpenRouter, Ollama, and LiteLLM, use the `openai-compatible` provider. It
uses Chat Completions and needs a key, endpoint (`DEEPNOTE_AGENT_BASE_URL`), and a model that
supports tool calling. Set the model in the block or use `openai-compatible:auto` with
`DEEPNOTE_AGENT_MODEL`. Use the endpoint's model IDs; for OpenRouter, for example,
`openai-compatible:anthropic/claude-opus-5.5`.

### Sharing notebooks with Cloud

Use `auto` or a supported model ID without a provider prefix, such as `claude-opus-5-5`,
`claude-sonnet-5-5`, `gpt-6-sol`, or `gpt-6-luna`. Unsupported names, including provider prefixes,
use workspace settings instead.

`auto` uses workspace settings in Cloud and the defaults above locally. Local keys and endpoints
do not configure Cloud.

## Result shape

Execution methods return `ExecutionSummary`:

- `totalBlocks`
- `executedBlocks`
- `failedBlocks`
- `totalDurationMs`
