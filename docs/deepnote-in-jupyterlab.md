---
title: Using Deepnote format in JupyterLab
description: Guide to viewing and working with Deepnote's YAML format in JupyterLab.
noIndex: false
noContent: false
---

# Using Deepnote format in JupyterLab

The Deepnote JupyterLab extension (`deepnote-jupyterlab`) allows you to view `.deepnote` files directly in JupyterLab. Currently, the extension is **read-only**, meaning you can view Deepnote projects but cannot edit them within JupyterLab. For editing workflows, you'll need to convert between formats.

## Understanding the formats

Jupyter notebooks use JSON format (.ipynb), which is machine‑optimized but creates noisy Git diffs and embeds outputs directly in the file. Deepnote uses YAML format (.deepnote), which is human‑readable, produces clean diffs, and can contain multiple notebooks within a single project file. Each project can also store integrations, settings, and metadata in one place — enabling organized workflows locally and collaboration in Deepnote Cloud.

If you want learn more about `.deepnote` format, check out the [Deepnote format docs](https://deepnote.com/docs/deepnote-format.md), or have a look at [Deepnote format in our repo](https://github.com/deepnote/deepnote/tree/main/packages/convert).

## Converting between formats

Install the converter tool:

```bash
npm install -g @deepnote/convert
```

Convert from Jupyter to Deepnote format:

```bash
deepnote-convert notebook.ipynb -o notebook.deepnote
```

For the reverse direction (Deepnote to Jupyter), you can parse the YAML structure and rebuild the JSON format, or use Deepnote Cloud's export functionality, more about this in [Deepnote documentation about format](https://deepnote.com/docs/migrating-to-ipynb).

## Viewing in JupyterLab

The `deepnote-jupyterlab` extension allows you to view `.deepnote` files directly in JupyterLab in read-only mode. For editing, convert to `.ipynb` first:

```bash
deepnote-convert notebook.deepnote -o notebook.ipynb
jupyter lab notebook.ipynb
```

## Recommended workflow

A practical approach is to work with `.ipynb` files in JupyterLab and convert to `.deepnote` for version control. Keep `.ipynb` files in your `.gitignore` and only commit the `.deepnote` versions.

Set up a simple conversion script:

```bash
#!/bin/bash
# Convert all notebooks before committing
for file in notebooks/*.ipynb; do
  deepnote-convert "$file" -o "${file%.ipynb}.deepnote" --clearOutputs
done
```

Add this to a git pre-commit hook to automate the conversion. When starting work, convert `.deepnote` files back to `.ipynb` for editing in JupyterLab.

## Deepnote-specific features

When converting from Deepnote to Jupyter format, some Deepnote-specific features require adaptation:

- **SQL blocks** convert to code cells with comments. You'll need to add database connection code manually or use JupyterLab's `%%sql` magic commands.
- **Input blocks** (sliders, dropdowns) convert to simple variable assignments. Replace them with `ipywidgets` if you need interactivity in JupyterLab.
- **Visualization blocks** convert to code cells. Use matplotlib or Altair to recreate the visualizations.

## Version control

Configure your `.gitignore` to exclude `.ipynb` files and only track `.deepnote` files. This keeps your repository clean with human-readable diffs.

The Deepnote format produces significantly cleaner git diffs than Jupyter's JSON format. Changes are easy to review block-by-block without the noise from execution counts and embedded outputs.
