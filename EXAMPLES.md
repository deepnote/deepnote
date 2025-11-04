# Examples

This is a guide to get you started with **Deepnote Open Source**, it is just a glimpse of what is possible. To get started just clone this repository.

```bash
git clone https://github.com/deepnote/deepnote.git
cd deepnote
```

## Converting a Jupyter Notebook to Deepnote

Let's start with the simple example, by converting a Jupyter Notebook to a .deepnote file, which is a Deepnote project.

As prerequisites, you will need to have [Node.js](https://nodejs.org/) and [Python3.10+](https://www.python.org/downloads/) installed on your system.

First you will need to install Deepnote converter, by opening a terminal and running this command:

```bash
npm install @deepnote/convert
```

After installing the converter, you can convert a Jupyter Notebook to a .deepnote file by running this command:

```bash
deepnote-convert ./examples/1_hello_world.ipynb
```

## Opening a Deepnote Project

To open a `.deepnote` project, you can use multiple ways, opening in your favorite editor [VSCode](https://code.visualstudio.com/), [Cursor](https://cursor.dev/), or [Windsurf](https://windsurf.com/), reading it in [JupyterLab](https://jupyter.org/), or opening it in [Deepnote Cloud](https://deepnote.com/).

For this example, we will use VS Code, but the steps are same for Cursor and Windsurf.

1. First install VS Code if you haven't already.
2. Open the folder where you cloned the repository. Or simply run `code .` in the terminal.
3. Then install the [Deepnote extension for VS Code](https://marketplace.visualstudio.com/items?itemName=Deepnote.vscode-deepnote) by navigating to Extensions in the left sidebar and search for `Deepnote` or press `Cmd+Shift+X` on Mac or `Ctrl+Shift+X` on Windows and search for `Deepnote`, and click on `Install`.
4. Then click on the Deepnote icon in the left sidebar, you will see a list of projects on the left sidebar.
5. And open by clicking on the project, and opening `1. Hello World - example`.

## Running a Deepnote Project

To run a Deepnote project, you can use any of the ways mentioned above (except JupyterLab, which is currently read-only).

To run this example, follow these steps:

1. To run the block, click the `Run` button or press `Cmd+Enter` on Mac or `Ctrl+Enter` on Windows.
2. If it is your first time running the block, you will be prompted to select a kernel so select `Python 3.10`.
3. The code should run and you should see `Hello world!` in the output panel.

## What's next?

You can have a look at [/examples](./examples) folder to see more sample projects and try running them out.
