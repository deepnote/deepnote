# Convert EDA.ipynb to a Deepnote project

This folder contains a sample Jupyter notebook `EDA.ipynb`. Use the `deepnote-convert` CLI (from `@deepnote/convert`) to convert it into a Deepnote project file (`.deepnote`).

## Prerequisites

- Node.js and npm (npx available)

## Quick start (from repo root)

Run the converter and save the output next to the input file:

```bash
npx deepnote-convert examples/Convert/EDA.ipynb \
  -o examples/Convert/EDA.deepnote \
  --projectName "EDA"
```

This creates `examples/Convert/EDA.deepnote`.

## Alternative (from this folder)

If you run the command from `examples/Convert/`:

```bash
npx deepnote-convert EDA.ipynb -o EDA.deepnote --projectName "EDA"
```

## Options you can use

- `--projectName <name>`
  Set the Deepnote project name. Defaults to the input filename (without extension).

- `-o, --outputPath <path>`
  Where to save the `.deepnote` file. If you provide a directory, the filename is auto-generated.

## Open in Deepnote

Once you have the `.deepnote` file, import it into Deepnote (e.g., via the "Import project" action in the Deepnote UI) or drag and drop the file into your workspace.

## Troubleshooting

- If `npx` is unavailable, install the CLI globally:
  ```bash
  npm i -g @deepnote/convert
  deepnote-convert EDA.ipynb -o EDA.deepnote
  ```

## Open in VS Code with the Deepnote extension

1. Install the extension
   - From Marketplace: search for "Deepnote" and install
   - Or via CLI:
     ```bash
     code --install-extension deepnote.vscode-deepnote       # VS Code
     # cursor --install-extension deepnote.vscode-deepnote   # Cursor (optional)
     # windsurf --install-extension deepnote.vscode-deepnote # Windsurf (optional)
     ```

2. Open the folder that contains `EDA.deepnote` in VS Code (File → Open Folder)

3. In Explorer, click `EDA.deepnote`
   - If prompted, choose "Open With..." → "Deepnote Notebook"

4. Run cells with Shift+Enter and use the toolbar to execute/clear outputs
