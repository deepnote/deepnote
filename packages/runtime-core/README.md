# @deepnote/runtime-core

Core runtime for executing Deepnote projects.

## Installation

```bash
npm install @deepnote/runtime-core
```

## Prerequisites

You must have `deepnote-toolkit` installed in your Python environment:

```bash
pip install deepnote-toolkit[server]
```

## Usage

```typescript
import { ExecutionEngine } from "@deepnote/runtime-core";

const engine = new ExecutionEngine({
  pythonPath: "python",
  workingDirectory: "/path/to/project",
});

await engine.start();

try {
  const summary = await engine.runFile("./my-project.deepnote", {
    onBlockStart: (block) => console.log(`Running ${block.type}...`),
    onBlockDone: (result) => console.log(result.success ? "✓" : "✗"),
  });

  console.log(`Executed ${summary.executedBlocks} blocks`);
} finally {
  await engine.stop();
}
```

## API

### `ExecutionEngine`

High-level API for executing Deepnote projects.

- `start()` - Start the deepnote-toolkit server and connect to the kernel
- `stop()` - Stop the server and disconnect
- `runFile(path, options)` - Execute a .deepnote file
- `runProject(file, options)` - Execute a parsed DeepnoteFile

### `startServer(options)` / `stopServer(info)`

Low-level API for managing the deepnote-toolkit server process.

### `KernelClient`

Low-level API for communicating with a Jupyter kernel via the Jupyter protocol.
