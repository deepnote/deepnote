# @deepnote/reactivity

Reactivity and dependency graph for Deepnote notebooks.

## Requirements

This package requires **Python 3** and the **jinja2** Python library to be installed on the system where it is running. The `jinja2` library is used for parsing variable dependencies in SQL blocks.

You can install the requirement via pip:

```bash
pip install jinja2
```

By default, the package looks for `python3` in the system path. You can override this by providing a `pythonInterpreter` path in the options of the main functions.

## Overview

This package provides utilities for analyzing dependencies between Deepnote blocks to build a reactivity graph. It uses a Python-based AST analyzer to identify defined and used variables in various block types.

- **AST Analysis**: Extracts variable definitions and usages from Python and SQL blocks.
- **Dependency Tracking**: Identifies how blocks depend on each other through variables.
- **Reactivity Support**: Powers the reactive execution model by analyzing block content.

## Usage

The primary entry point for the library is `getDagForBlocks`. It analyzes the content of the blocks and builds a Directed Acyclic Graph (DAG) representing their dependencies.

### Basic Example

```typescript
import { getDagForBlocks } from "@deepnote/reactivity";

const blocks = [
  // ... array of DeepnoteBlock objects
];

const { dag, newlyComputedBlocksContentDeps } = await getDagForBlocks(blocks);

// Access the dependency graph
console.log(dag.nodes);
console.log(dag.edges);
```

### Key Functions

- **`getDagForBlocks(blocks, options?)`**: Builds the complete dependency graph of the notebook. This is useful for mapping out data flow and powering features like dependency visualizations. Use `acceptPartialDAG: true` in the options if you want to receive a graph even if some blocks have syntax errors. Supports `pythonInterpreter` option.
- **`getDownstreamBlocks(blocks, blocksToExecute, options?)`**: Identifies all blocks that need to be re-run when specific upstream blocks are executed or modified. This is the core function for implementing **reactive execution**, ensuring that the entire notebook remains consistent. Supports `pythonInterpreter` option.
- **`getBlockDependencies(blocks, options?)`**: A lower-level utility that extracts variable definitions and usages from block content using AST analysis. It is useful for inspecting the inputs and outputs of individual blocks without constructing the full graph. Supports `pythonInterpreter` option.

### Core Concepts

- **Nodes**: Each block in the notebook is a node in the DAG. Nodes contain information about `inputVariables` (variables used) and `outputVariables` (variables defined).
- **Edges**: An edge exists from block A to block B if block B uses a variable defined by block A.
- **Reactivity**: By understanding these dependencies, Deepnote can automatically determine which blocks need to be re-run when a variable is changed in an upstream block.
