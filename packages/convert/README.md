# @deepnote/convert

Convert Jupyter Notebook files (`.ipynb`) to Deepnote project files (`.deepnote`).

## Installation

```bash
npm install -g @deepnote/convert
```

## CLI Usage

The package provides a `deepnote-convert` command-line tool for converting Jupyter notebooks to Deepnote format.

### Convert a Single Notebook

Convert a single `.ipynb` file to a `.deepnote` file:

```bash
deepnote-convert path/to/notebook.ipynb
```

This will create a `notebook.deepnote` file in the current directory.

### Convert a Directory of Notebooks

Convert all `.ipynb` files in a directory to a single `.deepnote` project:

```bash
deepnote-convert path/to/notebooks/
```

This will create a `notebooks.deepnote` file in the current directory containing all notebooks from the directory.

### Options

#### `--projectName <name>`

Set a custom name for the Deepnote project:

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

```bash
# Convert a single notebook with custom name
deepnote-convert titanic.ipynb --projectName "Titanic Analysis"

# Convert all notebooks in a directory
deepnote-convert ./analysis --projectName "Data Science Project" -o ./output

# Convert multiple notebooks from a folder
deepnote-convert ~/notebooks/ml-experiments -o ~/projects/
```

## Programmatic Usage

You can also use the conversion function programmatically in your Node.js or TypeScript applications.

### Basic Usage

```typescript
import { convertIpynbFilesToDeepnoteFile } from "@deepnote/convert";

await convertIpynbFilesToDeepnoteFile(["path/to/notebook.ipynb"], {
  outputPath: "output.deepnote",
  projectName: "My Project",
});
```

## License

Apache-2.0
