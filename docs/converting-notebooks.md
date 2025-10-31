---
title: Converting Jupyter notebooks to Deepnote format
description: Learn how to convert Jupyter Notebook files (`.ipynb`) to Deepnote project files (`.deepnote`) using the `@deepnote/convert` tool.
noIndex: false
noContent: false
---

# How to convert Jupyter notebooks to Deepnote format

This guide explains how to convert Jupyter Notebook files (`.ipynb`) to Deepnote project files (`.deepnote`) using the `@deepnote/convert` tool.

The `@deepnote/convert` package provides a command-line tool and programmatic API for converting standard Jupyter notebooks into Deepnote's open-source format. This allows you to:

- Migrate existing Jupyter notebooks to Deepnote format
- Convert single notebooks or entire directories
- Preserve code, markdown, outputs, and execution counts
- Create multi-notebook Deepnote projects

## Installation how to install @deepnote/convert

### Global installation (recommended for CLI)

Install the tool globally to use the `deepnote-convert` command from anywhere:

```bash
npm install -g @deepnote/convert
```

### Local installation (for programmatic use)

Install as a project dependency:

```bash
npm install @deepnote/convert
```

Or using other package managers:

```bash
# Using pnpm
pnpm add @deepnote/convert

# Using yarn
yarn add @deepnote/convert
```

### Requirements

- **Node.js**: Version 18 or higher

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

You can use the conversion function programmatically in Node.js or TypeScript applications.

### Basic example

```typescript
import { convertIpynbFilesToDeepnoteFile } from "@deepnote/convert";

await convertIpynbFilesToDeepnoteFile(["path/to/notebook.ipynb"], {
  outputPath: "output.deepnote",
  projectName: "My Project",
});
```

### Convert multiple notebooks

```typescript
import { convertIpynbFilesToDeepnoteFile } from "@deepnote/convert";

// Convert multiple notebooks into a single project
await convertIpynbFilesToDeepnoteFile(
  [
    "notebooks/data-cleaning.ipynb",
    "notebooks/analysis.ipynb",
    "notebooks/visualization.ipynb",
  ],
  {
    outputPath: "projects/data-pipeline.deepnote",
    projectName: "Data Pipeline",
  },
);
```

### With Error Handling

```typescript
import { convertIpynbFilesToDeepnoteFile } from "@deepnote/convert";

try {
  await convertIpynbFilesToDeepnoteFile(["notebook.ipynb"], {
    outputPath: "output.deepnote",
    projectName: "My Analysis",
  });
  console.log("Conversion successful!");
} catch (error) {
  console.error("Conversion failed:", error.message);
}
```

### API Reference

#### `convertIpynbFilesToDeepnoteFile(inputFilePaths, options)`

Converts Jupyter Notebook files to a Deepnote project file.

**Parameters:**

- `inputFilePaths` (string[]): Array of paths to `.ipynb` files to convert
- `options` (ConvertIpynbFilesToDeepnoteFileOptions):
  - `outputPath` (string): Path where the `.deepnote` file will be saved
  - `projectName` (string): Name for the Deepnote project

**Returns:** Promise<void>

**Throws:** Error if file reading or parsing fails

## Conversion Details

### What Gets Converted

The conversion process preserves:

- ✅ **Code cells**: Python/R/SQL code with syntax
- ✅ **Markdown cells**: Text, headers, lists, images, LaTeX
- ✅ **Cell outputs**: Execution results, plots, tables
- ✅ **Execution counts**: Cell execution order
- ✅ **Cell metadata**: Custom metadata attached to cells

### Project Structure

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

### CI/CD integration

Integrate conversion into your build pipeline:

```yaml
# .github/workflows/convert-notebooks.yml
name: Convert Notebooks
on: [push]

jobs:
  convert:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "18"
      - run: npm install -g @deepnote/convert
      - run: deepnote-convert notebooks/ -o dist/
      - uses: actions/upload-artifact@v3
        with:
          name: deepnote-projects
          path: dist/*.deepnote
```

## Next Steps

After converting your notebooks:

1. **Open in Deepnote**: Load the `.deepnote` file in the Deepnote application
2. **Configure environment**: Set up Python packages and environment variables
3. **Run notebooks**: Execute cells to ensure everything works

## Related Documentation

- [Deepnote Format Specification](./deepnote-format.md) - Details on the `.deepnote` file format
- [Local Setup Guide](./local-setup.md) - Running Deepnote locally
- [@deepnote/blocks Package](../../packages/blocks/README.md) - Working with Deepnote blocks programmatically

Want to have more, visit, than local setup visit [deepnote.com](https://deepnote.com)
