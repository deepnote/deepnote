# Getting started with Deepnote in VS Code

As prerequisites, you will need to have [Node.js](https://nodejs.org/), [Python3.10+](https://www.python.org/downloads/) and [VSCode](https://code.visualstudio.com/) installed on your system. This guide also works for [Cursor](https://cursor.dev/) and [Windsurf](https://windsurf.com/).

## Opening a Deepnote Project

To opening a `.deepnote` project, in VSCode you should:

1. Open the folder where you cloned the repository. Or simply run `code .` in the terminal.
2. Than install the [Deepnote extension for VS Code](https://marketplace.visualstudio.com/items?itemName=Deepnote.vscode-deepnote) by navigate to Extensions in the left sidebar and search for `Deepnote` or press `Cmd+Shift+X` on Mac or `Ctrl+Shift+X` on Windows and search for `Deepnote`, and click on `Install`.
3. Than click on the Deepnote icon in the left sidebar, you will see a list of projects on the left sidebar.
4. And open by clicking on the project, and opening your notebook.

## What is possible in Deepnote?

Will be using [blocks.deepnote](./blocks.deepnote) as an example, to show what blocks are possible in Deepnote.

1. **Markdown blocks** are added via + Markdown in the top bar for example have look at notebook `1. Text + code` .
   ![markdown](../../assets/examples/getting_started_with_deepnote_in_vscode/markdown.png)

2. **Input blocks** are added via three dots on the left of the top bar, or by pressing `Cmd+Shift+P` on Mac or `Ctrl+Shift+P` on Windows and typing `Deepnote: Add "block type"`.
   ![selecting block types](../../assets/examples/getting_started_with_deepnote_in_vscode/selecting_block_types.png)
   There are multiple type of input blocks, all the example are in `2. Input blocks` notebook, and here is how to use them :
   - **Input Text** are short text inputs, that are used for short text fields.
   - **Input Textarea** are long text inputs, that are used for long text fields.
   - **Input Select** are select inputs, that are used for select fields, if want to add or change the options use the setting icon in the bottom of the block, this will open settings page.
   - **Input Slider** are slider inputs, that are used for slider fields, if want to change the range use the min, max, or step in the bottom of the block.
   - **Input Checkbox** are checkbox inputs, that are used for checkbox fields, if you want select or deselect the checkbox, click on checked or unchecked in the bottom of the block.
   - **Input Date** are date inputs, to change them click on the date in the bottom of the block.
   - **Input Date Range** are date range inputs, to change the the range click on the start or end date in the bottom of the block.

3. **Integrations** are added via in the top bar by clicking on `Manage Integrations`.
   ![integrations manage](../../assets/examples/getting_started_with_deepnote_in_vscode/manage_integration.png)

   Or by pressing `Cmd+Shift+P` on Mac or `Ctrl+Shift+P` on Windows and typing `Deepnote: Manage Integrations`.
   ![integrations](../../assets/examples/getting_started_with_deepnote_in_vscode/integrations.png)

   Than it open Deepnote Integrations page where you can add integrations or manage existing integrations.
   ![integrations rendered](../../assets/examples/getting_started_with_deepnote_in_vscode/integrations_rendered.png)

   For example look at [integrations.deepnote](./integrations.deepnote) project, where we have added is a [ClickHouse playground](https://clickhouse.com/docs/getting-started/playground) integration which is free of use.
