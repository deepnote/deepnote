# CLI: Convert Command

Install: `npm install -g @deepnote/cli`

## `deepnote convert <path>`

Convert between notebook formats.

| Option                  | Description                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `-o, --output <path>`   | Output path (file or directory)                                                             |
| `-n, --name <name>`     | Project name (for conversions to .deepnote)                                                 |
| `-f, --format <format>` | Output format from .deepnote: `jupyter`, `percent`, `quarto`, `marimo` (default: `jupyter`) |
| `--open`                | Open converted .deepnote file in Deepnote Cloud                                             |

**Supported conversions:**

- **To .deepnote:** `.ipynb`, `.qmd`, `.py` (percent or Marimo)
- **From .deepnote:** `.ipynb`, `.qmd`, `.py` (percent or Marimo)

**Examples:**

```bash
# Convert Jupyter to Deepnote
deepnote convert notebook.ipynb

# Convert with custom output
deepnote convert notebook.ipynb -o my-project.deepnote

# Convert directory of notebooks
deepnote convert ./notebooks/

# Convert Deepnote to Quarto
deepnote convert project.deepnote -f quarto

# Convert Deepnote to Marimo
deepnote convert project.deepnote -f marimo
```
