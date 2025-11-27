# @deepnote/convert

Bidirectional converter between Jupyter Notebook files (`.ipynb`) and Deepnote project files (`.deepnote`) with lossless roundtrip support.

```bash
# Convert a Jupyter notebook to a Deepnote project
npx @deepnote/convert notebook.ipynb

# Convert a Deepnote project to Jupyter notebooks
npx @deepnote/convert project.deepnote
```

## Installation

```bash
npm install -g @deepnote/convert
```

## CLI Usage

The package provides a `deepnote-convert` command-line tool for bidirectional conversion between Jupyter and Deepnote formats.

### Convert Jupyter → Deepnote

#### Convert a Single Notebook

Convert a single `.ipynb` file to a `.deepnote` file:

```bash
deepnote-convert path/to/notebook.ipynb
```

This will create a `notebook.deepnote` file in the current directory.

#### Convert a Directory of Notebooks

Convert all `.ipynb` files in a directory to a single `.deepnote` project:

```bash
deepnote-convert path/to/notebooks/
```

This will create a `notebooks.deepnote` file in the current directory containing all notebooks from the directory.

### Convert Deepnote → Jupyter

Convert a `.deepnote` file to Jupyter notebooks:

```bash
deepnote-convert path/to/project.deepnote
```

This will create a `project/` directory containing separate `.ipynb` files for each notebook in the Deepnote project.

### Options

#### `--projectName <name>`

Set a custom name for the Deepnote project:

```bash
deepnote-convert notebook.ipynb --projectName "My Analysis"
```

If not specified, the project name will default to the filename (without extension) or directory name.

#### `-o, --outputPath <path>`

Specify where to save the output file(s):

```bash
# For Jupyter → Deepnote: Save to a specific file
deepnote-convert notebook.ipynb -o output/project.deepnote

# For Jupyter → Deepnote: Save to a directory (filename will be auto-generated)
deepnote-convert notebook.ipynb -o output/

# For Deepnote → Jupyter: Specify output directory for notebooks
deepnote-convert project.deepnote -o output/jupyter-notebooks/
```

If not specified:

- For Jupyter → Deepnote: Output file will be saved in the current directory
- For Deepnote → Jupyter: A directory will be created using the `.deepnote` filename (e.g., `project.deepnote` → `project/`)

### Examples

```bash
# Jupyter → Deepnote: Convert a single notebook with custom name
deepnote-convert titanic.ipynb --projectName "Titanic Analysis"

# Jupyter → Deepnote: Convert all notebooks in a directory
deepnote-convert ./analysis --projectName "Data Science Project" -o ./output

# Jupyter → Deepnote: Convert multiple notebooks from a folder
deepnote-convert ~/notebooks/ml-experiments -o ~/projects/

# Deepnote → Jupyter: Convert a Deepnote project to Jupyter notebooks
deepnote-convert my-project.deepnote

# Deepnote → Jupyter: Specify output directory
deepnote-convert my-project.deepnote -o ./jupyter-notebooks/
```

### Lossless Roundtrip Conversion

The converter supports lossless roundtrip conversions:

- **Deepnote → Jupyter → Deepnote**: Preserves all Deepnote-specific metadata in Jupyter cell metadata, enabling faithful reconstruction of the original notebook's structure and metadata (note: serialization formatting or key ordering may differ)
- **Jupyter → Deepnote → Jupyter**: Preserves original Jupyter content while adding Deepnote metadata

This is achieved by storing Deepnote-specific metadata as flat `deepnote_*` keys directly on Jupyter notebook metadata (e.g., `deepnote_notebook_id`, `deepnote_execution_mode`) and cell metadata (e.g., `deepnote_cell_type`, `deepnote_sorting_key`, `deepnote_source`).

## Programmatic Usage

You can also use the conversion functions programmatically in your Node.js or TypeScript applications.

### Jupyter → Deepnote

```typescript
import { convertIpynbFilesToDeepnoteFile } from "@deepnote/convert";

await convertIpynbFilesToDeepnoteFile(["path/to/notebook.ipynb"], {
  outputPath: "output.deepnote",
  projectName: "My Project",
});
```

### Deepnote → Jupyter

#### File-based Conversion

For automatic file I/O (reading and writing files):

```typescript
import { convertDeepnoteFileToJupyter } from "@deepnote/convert";

await convertDeepnoteFileToJupyter("path/to/project.deepnote", {
  outputDir: "./jupyter-notebooks",
});
```

#### Pure Conversion (No File I/O)

For programmatic use with in-memory data:

```typescript
import fs from "node:fs/promises";
import { deserializeDeepnoteFile } from "@deepnote/blocks";
import { convertDeepnoteToJupyterNotebooks } from "@deepnote/convert";

// Read and deserialize the Deepnote file
const yamlContent = await fs.readFile("project.deepnote", "utf-8");
const deepnoteFile = deserializeDeepnoteFile(yamlContent);

// Convert to Jupyter notebooks (pure function, no I/O)
const notebooks = convertDeepnoteToJupyterNotebooks(deepnoteFile);

// Now you can work with the notebooks in memory
for (const { filename, notebook } of notebooks) {
  console.log(`${filename}: ${notebook.cells.length} cells`);

  // Or save them yourself
  await fs.writeFile(filename, JSON.stringify(notebook, null, 2));
}
```

## License

Apache-2.0
