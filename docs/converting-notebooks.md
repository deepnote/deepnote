---
title: Converting Jupyter notebooks to Deepnote format
description: Learn how to convert Jupyter Notebook files (`.ipynb`) to Deepnote project files (`.deepnote`) using the `@deepnote/convert` tool.
noIndex: false
noContent: false
---

# How to convert Jupyter notebooks to Deepnote format

This guide explains how to convert Jupyter Notebook files (`.ipynb`) to Deepnote project files (`.deepnote`) and how to convert Deepnote projects to Jupyter notebooks using the `@deepnote/convert` tool.

The `@deepnote/convert` package provides a command-line tool and programmatic API for converting standard Jupyter notebooks into Deepnote's open-source format. This allows you to:

- Migrate existing Jupyter notebooks to Deepnote format
- Convert single notebooks or entire directories
- Preserve code, markdown, outputs, and execution counts
- Create multi-notebook Deepnote projects

## How to install @deepnote/convert

### Global installation (recommended for CLI)

Install the tool globally to use the `deepnote-convert` command from anywhere:

```bash
npm install -g @deepnote/convert
```

After converting your notebooks:

1. **Open in Deepnote**: Load the `.deepnote` file in the Deepnote application
2. **Configure environment**: Set up Python packages and environment variables
3. **Run notebooks**: Execute blocks to ensure everything works
4. **Open it using VS Code**: You can open it using [VS Code](https://marketplace.visualstudio.com/items?itemName=Deepnote.vscode-deepnote), [Cursor](https://open-vsx.org/extension/Deepnote/vscode-deepnote) or [Windsurf](https://open-vsx.org/extension/Deepnote/vscode-deepnote) extension.
5. **Open in [Deepnote](https://deepnote.com)**: If you want to collaborate and upgrade you workflow in cloud, as well as create data apps, in VS Code extension you can use Cmd+Shift+P(macOS) or Ctrl+Shift+P(Windows/Linux) and type `Deepnote: Open in Deepnote`(this creates a new project in Deepnote that is ready to use).

### Requirements

- **Node.js**: Version 20 or higher

## CLI usage

The package provides a `deepnote-convert` command-line tool for converting notebooks.

### Convert a single notebook

Convert a single `.ipynb` file to a `.deepnote` file:

```bash
deepnote-convert path/to/notebook.ipynb
```

This creates a `notebook.deepnote` file in the current directory containing a single-notebook project.

**Example:**

```bash
deepnote-convert analysis.ipynb
# Creates: analysis.deepnote
```

### Convert a directory of notebooks

Convert all `.ipynb` files in a directory to a single `.deepnote` project:

```bash
deepnote-convert path/to/notebooks/
```

This creates a multi-notebook project where each `.ipynb` file becomes a separate notebook within the project.

**Example:**

```bash
deepnote-convert ./ml-experiments
# Creates: ml-experiments.deepnote (containing all notebooks from the directory)
```

### CLI options

#### `--projectName <name>`

Set a custom name for the Deepnote project:

```bash
deepnote-convert notebook.ipynb --projectName "My Analysis"
```

If not specified, the project name defaults to:

- The filename (without extension) for single files
- The directory name for directories

#### `-o, --outputPath <path>`

Specify where to save the output `.deepnote` file:

```bash
# Save to a specific file
deepnote-convert notebook.ipynb -o output/project.deepnote

# Save to a directory (filename will be auto-generated)
deepnote-convert notebook.ipynb -o output/
```

If not specified, the output file is saved in the current directory.

### CLI Examples

```bash
# Convert with custom project name
deepnote-convert titanic.ipynb --projectName "Titanic Analysis"

# Convert directory with custom output location
deepnote-convert ./analysis --projectName "Data Science Project" -o ./output

# Convert multiple notebooks from a folder
deepnote-convert ~/notebooks/ml-experiments -o ~/projects/

# Convert and specify both name and output
deepnote-convert data.ipynb --projectName "Data Exploration" -o projects/exploration.deepnote
```

## Programmatic usage

You can use the conversion function programmatically in Node.js or TypeScript applications. Learn more in [In our converter examples repository](https://github.com/deepnote/deepnote/tree/main/packages/convert/examples/convert-pogramaticaly.md).

### Project structure

The resulting `.deepnote` file contains:

```yaml
metadata:
  createdAt: "2024-01-01T00:00:00.000Z"
project:
  id: "unique-project-id"
  name: "Project Name"
  notebooks:
    - id: "notebook-id"
      name: "Notebook Name"
      blocks:
        - id: "block-id"
          type: "code" | "markdown"
          content: "cell content"
          outputs: [...]
          executionCount: 1
version: "1.0.0"
```

### Limitations

- **Raw cells**: Raw cells are not currently converted
- **Widgets**: Interactive widgets may not be fully preserved
- **Extensions**: Jupyter extensions and custom cell types are not supported
- **Kernel metadata**: Kernel-specific metadata is not preserved

## Use cases

### Migrating existing projects

Convert an entire project directory:

```bash
deepnote-convert ~/jupyter-projects/data-analysis \
  --projectName "Data Analysis Project" \
  -o ~/deepnote-projects/
```

### Batch conversion script

Create a script to convert multiple projects:

```typescript
import { convertIpynbFilesToDeepnoteFile } from "@deepnote/convert";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function convertAllNotebooks(inputDir: string, outputDir: string) {
  const files = await readdir(inputDir);
  const ipynbFiles = files
    .filter((f) => f.endsWith(".ipynb"))
    .map((f) => join(inputDir, f));

  for (const file of ipynbFiles) {
    const name = file.replace(".ipynb", "");
    await convertIpynbFilesToDeepnoteFile([file], {
      outputPath: join(outputDir, `${name}.deepnote`),
      projectName: name,
    });
  }
}
```

Want to have more, visit [deepnote.com](https://deepnote.com)
