# @deepnote/runtime-core

Core runtime for executing Deepnote projects.

This project is under active development and is not ready for use. Expect breaking changes.

## Installation

```bash
npm install @deepnote/runtime-core
```

## Prerequisites

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
- Callbacks: `onBlockStart`, `onBlockDone`, `onOutput`, `onServerStarting`, `onServerReady`

## Result shape

Execution methods return `ExecutionSummary`:

- `totalBlocks`
- `executedBlocks`
- `failedBlocks`
- `totalDurationMs`
