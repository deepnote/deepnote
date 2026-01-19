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
  pythonPath: "python",
  workingDirectory: "/path/to/project",
});

try {
  await engine.start();

  const summary = await engine.runFile("./my-project.deepnote", {
    onBlockStart: (block) => console.log(`Running ${block.type}...`),
    onBlockDone: (result) => console.log(result.success ? "✓" : "✗"),
  });

  console.log(`Executed ${summary.executedBlocks} blocks`);
} finally {
  await engine.stop();
}
```
