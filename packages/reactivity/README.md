# @deepnote/reactivity

Reactivity and dependency graph for Deepnote notebooks. This package provides:

1. **AST Analyzer** - Parses Python code to extract variable definitions and usages
2. **DAG Builder** - Builds a directed acyclic graph of cell dependencies
3. **DAG Analyzer** - Finds downstream cells that need to re-run when a cell changes

## Usage

### In Node.js (with child process)

```typescript
import { getBlocksContentDeps } from "@deepnote/reactivity";

const blocks = [
  { cellId: "a", cell_type: "code", source: "x = 1" },
  { cellId: "b", cell_type: "code", source: "y = x + 1" },
];

const deps = await getBlocksContentDeps(blocks);
```

### In Browser (with Pyodide)

```typescript
import {
  createBrowserAstAnalyzer,
  buildDAGFromBlocks,
  getDownstreamBlocksForBlocksIds,
} from "@deepnote/reactivity/browser";

// Initialize with Pyodide instance
const analyzer = createBrowserAstAnalyzer(pyodide);

// Analyze blocks
const deps = await analyzer.analyzeBlocks(blocks);

// Build DAG
const dag = buildDAGFromBlocks(deps);

// Get downstream blocks when cell 'a' changes
const downstream = getDownstreamBlocksForBlocksIds(dag, ["a"]);
```

## Features

- Full Python AST parsing for variable extraction
- SQL block support with Jinja variable detection
- Input block support (text, select, slider, etc.)
- Efficient DAG traversal for reactive updates
- Browser-compatible via Pyodide

## License

MIT
