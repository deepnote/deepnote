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

A block's `deepnote_agent_model` takes an optional `provider:model` prefix, resolved by
`resolveAgentModel()`. A bare model name (`gpt-5`) or `auto` means `openai`, so notebooks written
before prefixes existed are unaffected.

| Provider id         | Default model                | API key                  | Base URL                  |
| ------------------- | ---------------------------- | ------------------------ | ------------------------- |
| `openai`            | `gpt-5`                      | `OPENAI_API_KEY`         | `OPENAI_BASE_URL`         |
| `anthropic`         | `claude-opus-5`              | `ANTHROPIC_API_KEY`      | `ANTHROPIC_BASE_URL`      |
| `openai-compatible` | none — errors if unspecified | `DEEPNOTE_AGENT_API_KEY` | `DEEPNOTE_AGENT_BASE_URL` |

`openai-compatible` covers OpenRouter, Ollama, LiteLLM, vLLM, Together and Groq, and falls back to
the `OPENAI_*` variables when its own are unset. Each provider also reads a `*_MODEL` variable used
when the block says `auto`.

## Result shape

Execution methods return `ExecutionSummary`:

- `totalBlocks`
- `executedBlocks`
- `failedBlocks`
- `totalDurationMs`
