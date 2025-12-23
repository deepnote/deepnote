# @deepnote/convert

Bidirectional converter between Deepnote project files (`.deepnote`) and multiple notebook formats: Jupyter (`.ipynb`), Quarto (`.qmd`), Percent (`.py`), and Marimo (`.py`).

```bash
# Convert any supported format to Deepnote
npx @deepnote/convert notebook.ipynb
npx @deepnote/convert document.qmd
npx @deepnote/convert notebook.py  # percent or marimo format

# Convert Deepnote to any supported format
npx @deepnote/convert project.deepnote                      # defaults to Jupyter
npx @deepnote/convert project.deepnote --outputFormat quarto
npx @deepnote/convert project.deepnote --outputFormat percent
npx @deepnote/convert project.deepnote --outputFormat marimo
```

## Installation

```bash
npm install -g @deepnote/convert
```

## Supported Formats

| Format      | Extension | Description                                             |
| ----------- | --------- | ------------------------------------------------------- |
| **Jupyter** | `.ipynb`  | Standard Jupyter Notebook JSON format                   |
| **Quarto**  | `.qmd`    | Quarto markdown documents with code chunks              |
| **Percent** | `.py`     | Python files with `# %%` cell markers (VS Code, Spyder) |
| **Marimo**  | `.py`     | Marimo reactive notebooks with `@app.cell` decorators   |

## CLI Usage

The package provides a `deepnote-convert` command-line tool for bidirectional conversion.

### Convert to Deepnote

Any supported format converts to `.deepnote` automatically:

```bash
# Single file
deepnote-convert notebook.ipynb
deepnote-convert document.qmd
deepnote-convert notebook.py  # auto-detects percent vs marimo

# Directory of files
deepnote-convert path/to/notebooks/
```

### Convert from Deepnote

Use `--outputFormat` to choose the target format (defaults to `jupyter`):

```bash
deepnote-convert project.deepnote                        # → Jupyter notebooks
deepnote-convert project.deepnote --outputFormat jupyter # → Jupyter notebooks
deepnote-convert project.deepnote --outputFormat quarto  # → Quarto documents
deepnote-convert project.deepnote --outputFormat percent # → Percent format files
deepnote-convert project.deepnote --outputFormat marimo  # → Marimo notebooks
```

### Options

#### `--projectName <name>`

Set a custom name for the Deepnote project (when converting to `.deepnote`):

```bash
deepnote-convert notebook.ipynb --projectName "My Analysis"
```

#### `-o, --outputPath <path>`

Specify where to save the output:

```bash
# To Deepnote: Save to a specific file or directory
deepnote-convert notebook.ipynb -o output/project.deepnote
deepnote-convert notebook.ipynb -o output/

# From Deepnote: Specify output directory
deepnote-convert project.deepnote -o output/notebooks/
```

#### `--outputFormat <format>`

Choose output format when converting from `.deepnote`:

```bash
deepnote-convert project.deepnote --outputFormat quarto
```

Options: `jupyter` (default), `quarto`, `percent`, `marimo`

### Examples

```bash
# Jupyter → Deepnote
deepnote-convert titanic.ipynb --projectName "Titanic Analysis"
deepnote-convert ./notebooks -o ./output

# Quarto → Deepnote
deepnote-convert analysis.qmd --projectName "Data Report"

# Percent → Deepnote (auto-detected from # %% markers)
deepnote-convert script.py

# Marimo → Deepnote (auto-detected from @app.cell decorators)
deepnote-convert reactive.py

# Deepnote → various formats
deepnote-convert project.deepnote                        # Jupyter (default)
deepnote-convert project.deepnote --outputFormat quarto  # Quarto
deepnote-convert project.deepnote --outputFormat percent # Percent
deepnote-convert project.deepnote --outputFormat marimo  # Marimo
```

### Python File Detection

When converting `.py` files, the converter auto-detects the format:

- **Marimo**: Contains `import marimo` and `@app.cell` decorators
- **Percent**: Contains `# %%` cell markers

For directory scanning, use explicit naming:

- `*.marimo.py` for Marimo files
- `*.percent.py` for percent format files

### Lossless Roundtrip Conversion

The converter supports lossless roundtrip conversions for Jupyter:

- **Deepnote → Jupyter → Deepnote**: Preserves all Deepnote-specific metadata in Jupyter cell metadata
- **Jupyter → Deepnote → Jupyter**: Preserves original Jupyter content while adding Deepnote metadata

Other formats (Quarto, Percent, Marimo) preserve content and structure but may not retain all Deepnote-specific metadata.

### Platform Compatibility

Since Jupyter (`.ipynb`) is the standard format, notebooks from cloud platforms that use Jupyter are fully supported with metadata preservation:

| Platform               | Status              | Notes                                              |
| ---------------------- | ------------------- | -------------------------------------------------- |
| **Google Colab**       | ✅ Fully compatible | Preserves Colab cell IDs, form cells, GPU settings |
| **Amazon SageMaker**   | ✅ Fully compatible | Preserves tags, training/inference markers         |
| **Kaggle**             | ✅ Fully compatible | Preserves UUIDs, cell GUIDs, hide input/output     |
| **Azure ML Notebooks** | ✅ Fully compatible | Standard Jupyter with Azure metadata               |
| **JupyterLab/Hub**     | ✅ Fully compatible | Standard Jupyter format                            |

Platform-specific cell metadata is preserved during roundtrip conversion, allowing notebooks to be edited in Deepnote and exported back to the original platform without losing settings.

## Programmatic Usage

### Convert to Deepnote

```typescript
import {
  convertIpynbFilesToDeepnoteFile,
  convertQuartoFilesToDeepnoteFile,
  convertPercentFilesToDeepnoteFile,
  convertMarimoFilesToDeepnoteFile,
} from "@deepnote/convert";

// From Jupyter
await convertIpynbFilesToDeepnoteFile(["notebook.ipynb"], {
  outputPath: "output.deepnote",
  projectName: "My Project",
});

// From Quarto
await convertQuartoFilesToDeepnoteFile(["document.qmd"], {
  outputPath: "output.deepnote",
  projectName: "My Project",
});

// From Percent
await convertPercentFilesToDeepnoteFile(["script.py"], {
  outputPath: "output.deepnote",
  projectName: "My Project",
});

// From Marimo
await convertMarimoFilesToDeepnoteFile(["notebook.py"], {
  outputPath: "output.deepnote",
  projectName: "My Project",
});
```

### Convert from Deepnote

```typescript
import {
  convertDeepnoteFileToJupyter,
  convertDeepnoteFileToQuartoFiles,
  convertDeepnoteFileToPercentFiles,
  convertDeepnoteFileToMarimoFiles,
} from "@deepnote/convert";

// To Jupyter
await convertDeepnoteFileToJupyter("project.deepnote", {
  outputDir: "./jupyter-notebooks",
});

// To Quarto
await convertDeepnoteFileToQuartoFiles("project.deepnote", {
  outputDir: "./quarto-docs",
});

// To Percent
await convertDeepnoteFileToPercentFiles("project.deepnote", {
  outputDir: "./percent-scripts",
});

// To Marimo
await convertDeepnoteFileToMarimoFiles("project.deepnote", {
  outputDir: "./marimo-notebooks",
});
```

### Pure Conversion (No File I/O)

For programmatic use with in-memory data:

```typescript
import fs from "node:fs/promises";
import { deserializeDeepnoteFile } from "@deepnote/blocks";
import {
  convertDeepnoteToJupyterNotebooks,
  convertDeepnoteToQuartoDocuments,
  convertDeepnoteToPercentNotebooks,
  convertDeepnoteToMarimoApps,
} from "@deepnote/convert";

// Read and deserialize the Deepnote file
const yamlContent = await fs.readFile("project.deepnote", "utf-8");
const deepnoteFile = deserializeDeepnoteFile(yamlContent);

// Convert to any format (pure functions, no I/O)
const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(deepnoteFile);
const quartoDocuments = convertDeepnoteToQuartoDocuments(deepnoteFile);
const percentNotebooks = convertDeepnoteToPercentNotebooks(deepnoteFile);
const marimoApps = convertDeepnoteToMarimoApps(deepnoteFile);

// Work with the results in memory
for (const { filename, notebook } of jupyterNotebooks) {
  console.log(`${filename}: ${notebook.cells.length} cells`);
}
```

## License

Apache-2.0
