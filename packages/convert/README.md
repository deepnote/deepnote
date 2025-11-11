# @deepnote/convert

Bidirectional converter between Jupyter Notebook files (`.ipynb`) and Deepnote project files (`.deepnote`).

## Installation

```bash
npm install -g @deepnote/convert
```

## CLI Usage

The package provides a `deepnote-convert` command-line tool for bidirectional conversion between Jupyter notebooks and Deepnote projects.

### Jupyter → Deepnote

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

### Deepnote → Jupyter

Convert a `.deepnote` project file to Jupyter notebook(s):

```bash
deepnote-convert path/to/project.deepnote
```

This will create a `project/` directory containing `.ipynb` files for each notebook in the project.

### Options

#### `--projectName <name>`

Set a custom name for the Deepnote project (Jupyter → Deepnote only):

```bash
deepnote-convert notebook.ipynb --projectName "My Analysis"
```

If not specified, the project name will default to the filename (without extension) or directory name.

#### `-o, --outputPath <path>`

Specify where to save the output `.deepnote` file:

```bash
# Save to a specific file
deepnote-convert notebook.ipynb -o output/project.deepnote

# Save to a directory (filename will be auto-generated)
deepnote-convert notebook.ipynb -o output/
```

If not specified, the output file will be saved in the current directory.

### Examples

#### Jupyter → Deepnote

```bash
# Convert a single notebook with custom name
deepnote-convert titanic.ipynb --projectName "Titanic Analysis"

# Convert all notebooks in a directory
deepnote-convert ./analysis --projectName "Data Science Project" -o ./output

# Convert multiple notebooks from a folder
deepnote-convert ~/notebooks/ml-experiments -o ~/projects/
```

#### Deepnote → Jupyter

```bash
# Convert a Deepnote project to Jupyter notebooks
deepnote-convert project.deepnote

# Convert with custom output directory
deepnote-convert project.deepnote -o ./output
```

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

```typescript
import { convertDeepnoteFileToIpynb } from "@deepnote/convert";

await convertDeepnoteFileToIpynb("path/to/project.deepnote", {
  outputDir: "./output",
  addCreatedInDeepnoteCell: true, // Optional, defaults to true
});
```

## Conversion Details

### Jupyter → Deepnote

- Code cells → Code blocks
- Markdown cells → Markdown blocks
- Outputs and execution counts are preserved

### Deepnote → Jupyter

- **Code blocks** → Code cells (preserved as-is)
- **Markdown blocks** → Markdown cells
- **Text blocks** (h1, h2, h3, p, bullet, todo, callout) → Markdown cells with appropriate formatting
- **SQL blocks** → Code cells with `_dntk.execute_sql()` calls
- **Input blocks** (text, checkbox, select, slider, date, etc.) → Code cells with variable assignments
- **Visualization blocks** → Code cells with visualization specifications
- **Big number blocks** → Code cells with KPI display logic
- **Button blocks** → Code cells with button logic
- **Image blocks** → Markdown cells with `<img>` tags
- **Separator blocks** → Markdown cells with `<hr>`

Note: Some Deepnote-specific features (like interactivity in input widgets) cannot be fully preserved in standard Jupyter notebooks, but the equivalent Python code is generated to create the same variables and results.

## License

Apache-2.0
