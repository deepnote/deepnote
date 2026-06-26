---
title: Converting Jupyter notebooks to Deepnote format
description: Learn how to convert Jupyter Notebook files (`.ipynb`) to Deepnote project files (`.deepnote`) using the `@deepnote/convert` tool.
noIndex: false
noContent: false
---

# How to convert Jupyter notebooks to Deepnote format

This guide explains how to convert Jupyter Notebook files (`.ipynb`) to Deepnote project files (`.deepnote`) using the `@deepnote/convert` tool and how to convert Deepnote projects back to Jupyter notebooks via [deepnote.com](https://deepnote.com).

The `@deepnote/convert` package provides a command-line tool and programmatic API for converting between Jupyter notebooks and Deepnote's open-source format. This allows you to:

- Migrate existing Jupyter notebooks to Deepnote format
- Convert single notebooks or entire directories
- Preserve code, markdown, outputs, and execution counts
- Convert Deepnote projects back to Jupyter notebooks via [deepnote.com](https://deepnote.com)
- Convert [ipynb files to PDF](https://deepnote.com/ipynb-to-pdf) when you need a static, shareable document rather than an editable notebook

## How to install [@deepnote/convert](https://www.npmjs.com/package/@deepnote/convert)

### Global installation (recommended for CLI)

Install the tool globally to use the `deepnote-convert` command from anywhere:

```bash
npm install -g @deepnote/convert
```

After converting your notebooks, you can open them either in Deepnote or directly in your IDE ([VS Code](https://marketplace.visualstudio.com/items?itemName=Deepnote.vscode-deepnote), [Cursor](https://open-vsx.org/extension/Deepnote/vscode-deepnote), or [Windsurf](https://open-vsx.org/extension/Deepnote/vscode-deepnote)).

Option 1: Open directly in [Deepnote](https://deepnote.com)

1. Load the `.deepnote` file in the Deepnote application.
2. Configure the environment — install required Python packages and set environment variables.
3. Run the notebook in Deepnote Cloud to collaborate in real time, build data apps, and enhance your workflow with AI tools.

Option 2: Open in your IDE

1. Open the `.deepnote` file in VS Code, Cursor, or Windsurf.
2. Install the official Deepnote extension:
   - For VS Code: [Deepnote](https://marketplace.visualstudio.com/items?itemName=Deepnote.vscode-deepnote)
   - For Cursor and Windsurf: [Deepnote](https://open-vsx.org/extension/Deepnote/vscode-deepnote)
3. To move your project to the cloud for collaboration or app creation:
   - Press Cmd+Shift+P (macOS) or Ctrl+Shift+P (Windows/Linux)
   - Type “Deepnote: Open in Deepnote”
   - This creates a new Deepnote project ready to use

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

Convert every `.ipynb` file in a directory, each to its own single-notebook `.deepnote` file:

```bash
deepnote-convert path/to/notebooks/
```

Each notebook becomes its own `.deepnote` file, named after the source notebook and written into the input directory. Pass `-o <dir>` to write them somewhere else.

**Example:**

```bash
deepnote-convert ./ml-experiments
# Creates ./ml-experiments/<name>.deepnote for each notebook in the directory
```

### Convert .deepnote to .ipynb

Upload `.deepnote` file to [deepnote.com](https://deepnote.com) and download as `.ipynb` file.

### CLI options

#### `--projectName <name>`

Set a custom name for the Deepnote project:

```bash
deepnote-convert notebook.ipynb --projectName "My Analysis"
```

When converting a directory, all output files belong to one project, so `--projectName` sets the shared project name on every file (each file is still named after its own source notebook). If not specified, the project name defaults to the filename for a single file, or the directory name for a directory.

#### `-o, --outputPath <path>`

Specify where to save the output:

```bash
# Single file → save to a specific file
deepnote-convert notebook.ipynb -o output/project.deepnote

# Single file → save into a directory (filename auto-generated)
deepnote-convert notebook.ipynb -o output/

# Directory → write each notebook's .deepnote into this output directory
deepnote-convert path/to/notebooks/ -o output/
```

For a single file the output defaults to the current directory; for a directory it defaults to the input directory.

### CLI Examples

```bash
# Convert with custom project name
deepnote-convert titanic.ipynb --projectName "Titanic Analysis"

# Convert a directory into a custom output location (one .deepnote per notebook)
deepnote-convert ./analysis -o ./output

# Convert every notebook in a folder, writing the .deepnote files elsewhere
deepnote-convert ~/notebooks/ml-experiments -o ~/projects/

# Convert and specify both name and output
deepnote-convert data.ipynb --projectName "Data Exploration" -o projects/exploration.deepnote
```

## Programmatic usage

You can use the conversion function programmatically in Node.js or TypeScript applications. Learn more in [our converter docs section](https://github.com/deepnote/deepnote/tree/main/packages/convert/docs/convert-programmatically.md).

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

## Converting Deepnote projects back to Jupyter notebooks

While the CLI tool currently only supports converting Jupyter notebooks to Deepnote format, you can convert Deepnote projects back to Jupyter notebooks using the Deepnote web application:

1. **Upload to Deepnote**: Go to [deepnote.com](https://deepnote.com) and upload your `.deepnote` file to create a new project
2. **Open the project**: Once uploaded, open the project in Deepnote
3. **Download as Jupyter notebook**: For each notebook in your project, click the notebook menu (three dots) and select **"Download as .ipynb"**
4. **Export the notebook**: The notebook will be downloaded as a standard Jupyter notebook file that you can use in any Jupyter-compatible environment

This workflow allows you to work with Deepnote's enhanced features and collaboration tools, then export your work back to the standard Jupyter format when needed.

## Use cases

### Migrating existing projects

Convert an entire project directory — each notebook becomes its own `.deepnote` file:

```bash
deepnote-convert ~/jupyter-projects/data-analysis -o ~/deepnote-projects/
```

### Batch conversion script

Create a script to convert multiple projects. (For a plain directory of notebooks, `deepnote-convert <dir>` already writes one `.deepnote` per notebook — a script like this is only needed for custom logic.)

```typescript
import { convertIpynbFileToDeepnoteFile } from "@deepnote/convert";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

async function convertAllNotebooks(inputDir: string, outputDir: string) {
  const files = await readdir(inputDir);
  const ipynbFiles = files
    .filter((f) => f.endsWith(".ipynb"))
    .map((f) => join(inputDir, f));

  for (const file of ipynbFiles) {
    const name = basename(file, ".ipynb");
    await convertIpynbFileToDeepnoteFile(file, {
      outputPath: join(outputDir, `${name}.deepnote`),
      projectName: name,
    });
  }
}
```
