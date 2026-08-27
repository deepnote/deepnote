---
title: IPyWidgets in Deepnote
description: IPyWidgets are not available in the current Deepnote environment. Use native blocks for notebook interactivity.
noIndex: false
noContent: false
---

## IPyWidgets availability

The current Deepnote environment does not include the `ipywidgets` package. A live check with `import ipywidgets as widgets` returned `ModuleNotFoundError: No module named 'ipywidgets'`.

## Native alternatives

Use Deepnote's native blocks when you need notebook interactivity:

- Use **Chart** blocks for no-code data visualizations.
- Use **Input** blocks for text, select, slider, checkbox, date, file, and button inputs.
- Use **Text** blocks to add written context to a notebook.

These native blocks are available from the notebook footer and do not require the `ipywidgets` package.
