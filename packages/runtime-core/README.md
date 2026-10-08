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

A block's `deepnote_agent_model` accepts a bare model id. Claude ids such as `claude-opus-5-5`
select Anthropic; other bare names select OpenAI. `auto`, Cloud's `default` sentinel, and an
omitted model use the local OpenAI default below. Local execution also accepts an explicit
`provider:model` prefix, such as `openai-compatible:llama4`.

| Provider id         | Default model                | API key                  | Base URL                  |
| ------------------- | ---------------------------- | ------------------------ | ------------------------- |
| `openai`            | `gpt-6.1-sol`                | `OPENAI_API_KEY`         | `OPENAI_BASE_URL`         |
| `anthropic`         | `claude-opus-5-5`            | `ANTHROPIC_API_KEY`      | `ANTHROPIC_BASE_URL`      |
| `openai-compatible` | none — errors if unspecified | `DEEPNOTE_AGENT_API_KEY` | `DEEPNOTE_AGENT_BASE_URL` |

`openai-compatible` covers OpenRouter, Ollama, LiteLLM, vLLM, Together and Groq, and falls back to
the `OPENAI_*` variables when its own are unset. Each provider also reads a `*_MODEL` variable used
when the block says `auto`.

The defaults use [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and
[Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview).
Direct OpenAI access and GPT-6 models use the Responses API, including through `OPENAI_BASE_URL`
proxies. The proxy must support Responses for these models. Other models on custom base URLs
retain Chat Completions. Use `openai-compatible` for an endpoint that only supports Chat Completions
and select a model that supports tools there. OpenRouter uses its own model ids, for example
`openai-compatible:anthropic/claude-opus-5.5`.

Summarized adaptive thinking is enabled for Opus, Sonnet, and Haiku 5.5. Other Anthropic models
use their API defaults, so older models do not receive unsupported thinking options.

### Sharing notebooks with Cloud

Use bare ids from Cloud's supported catalog, such as `claude-opus-5-5`, `claude-sonnet-5-5`,
`gpt-6-sol`, or `gpt-6-luna`. Cloud chooses the provider for those ids. Provider prefixes are a
local extension: Cloud does not parse them and falls back to workspace settings for unsupported
names. GPT-6.1 Sol is available locally but is not in Cloud's catalog as of October 8, 2026.
For portable automatic selection, use `auto`: local execution uses the defaults above, while
Cloud uses workspace settings. Provider keys and custom endpoints configured locally do not
configure Cloud.

## Result shape

Execution methods return `ExecutionSummary`:

- `totalBlocks`
- `executedBlocks`
- `failedBlocks`
- `totalDurationMs`
