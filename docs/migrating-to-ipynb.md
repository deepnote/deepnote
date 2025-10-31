---
title: How to Migrate from Deepnote format to Jupyter notebooks
description: Learn how to convert Deepnote project files (`.deepnote`) back to standard Jupyter Notebook files (`.ipynb`) for use with other tools and platforms.
noIndex: false
noContent: false
---

# Migrating from Deepnote format to Jupyter notebooks

This guide explains how to export Deepnote project files (`.deepnote`) to standard Jupyter Notebook files (`.ipynb`) for compatibility with other tools and platforms.

While Deepnote's format offers enhanced features like input blocks, visualizations, and multi-notebook projects, you may need to export your work to standard Jupyter notebooks for:

- Sharing with collaborators using other platforms
- Publishing to repositories or documentation sites
- Running in traditional Jupyter environments
- Archiving or backup purposes

## Available export methods

### Manual export from Deepnote application

The primary way to convert Deepnote projects to Jupyter format is through the Deepnote cloud application:

1. **Open your project** in Deepnote
2. **Click the project menu** (three dots in the top right)
3. **Select "Export"** from the dropdown
4. **Choose "Download as .ipynb"** for Jupyter format
5. **Select notebooks** to export (or export all)
6. **Download** the generated files

This method handles the conversion automatically and ensures compatibility with standard Jupyter notebooks.

### Note about @deepnote/convert package

The `@deepnote/convert` package converts **from** `.ipynb` **to** `.deepnote` format only (see [Converting to Deepnote format](./converting-notebooks.md)). It does not support the reverse direction (`.deepnote` to `.ipynb`).

### Programmatic conversion with @deepnote/blocks

For custom conversion workflows from `.deepnote` to `.ipynb`, you can use the `@deepnote/blocks` package to read `.deepnote` files and generate `.ipynb` files programmatically. This requires writing your own conversion logic using the package's utilities:

```bash
npm install @deepnote/blocks
```

```typescript
import {
  deserializeDeepnoteFile,
  createPythonCode,
  createMarkdown,
} from "@deepnote/blocks";
import { readFile, writeFile } from "node:fs/promises";

// Read and parse .deepnote file
const yamlContent = await readFile("project.deepnote", "utf-8");
const deepnoteFile = deserializeDeepnoteFile(yamlContent);

// Get the first notebook
const notebook = deepnoteFile.project.notebooks[0];

// Convert blocks to Jupyter cells
const cells = notebook.blocks.map((block) => {
  if (block.type === "code" || block.type === "sql") {
    return {
      cell_type: "code",
      execution_count: block.executionCount ?? null,
      metadata: {},
      outputs: block.outputs || [],
      source: block.type === "code" ? block.content : createPythonCode(block),
    };
  } else {
    return {
      cell_type: "markdown",
      metadata: {},
      source: createMarkdown(block),
    };
  }
});

// Create Jupyter notebook structure
const ipynb = {
  cells,
  metadata: {
    kernelspec: {
      display_name: "Python 3",
      language: "python",
      name: "python3",
    },
  },
  nbformat: 4,
  nbformat_minor: 5,
};

// Write .ipynb file
await writeFile("notebook.ipynb", JSON.stringify(ipynb, null, 2), "utf-8");
```

Note that `@deepnote/blocks` provides utilities for reading Deepnote files and converting blocks to Python/Markdown, but you'll need to implement the full `.ipynb` structure yourself.

## Understanding format differences

When exporting from Deepnote to Jupyter format, here's what to expect:

### What converts well

- ✅ **Code cells**: Python code blocks convert directly to code cells
- ✅ **Markdown cells**: Text blocks convert to markdown cells
- ✅ **Cell outputs**: Execution results, plots, and tables are preserved
- ✅ **Execution counts**: Cell execution order is maintained

### What requires adaptation

- ⚠️ **SQL blocks**: May convert to Python code using database connections
- ⚠️ **Input blocks**: Convert to static Python variable assignments
- ⚠️ **Visualizations**: May convert to code that generates the chart
- ⚠️ **Multi-notebook projects**: Each notebook becomes a separate `.ipynb` file

### What doesn't convert

- ❌ **Interactive inputs**: Sliders, dropdowns, date pickers (become static values)
- ❌ **Button blocks**: Interactive buttons (not included in export)
- ❌ **Big number blocks**: KPI displays (may become markdown or code)
- ❌ **Project-level settings**: Environment variables, integrations
- ❌ **Deepnote-specific features**: Scheduled runs, app deployments

## Alternative approaches

For other export formats or workflows, consider using Jupyter's built-in tools after exporting to `.ipynb`:

- **nbconvert**: Convert notebooks to HTML, PDF, Markdown, and other formats
- **Papermill**: Execute notebooks programmatically with parameters
- **Jupytext**: Maintain notebooks as Python scripts alongside `.ipynb` files
