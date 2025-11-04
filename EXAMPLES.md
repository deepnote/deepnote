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
3. Then install the [Deepnote extension for VS Code](https://marketplace.visualstudio.com/items?itemName=Deepnote.vscode-deepnote) by navigating to Extensions in the left sidebar and searching for `Deepnote` or press `Cmd+Shift+X` on Mac or `Ctrl+Shift+X` on Windows and search for `Deepnote`, and click on `Install`.
4. Then click on the Deepnote icon in the left sidebar, you will see a list of projects on the left sidebar.
5. Open by clicking on the project, and opening `1. Hello World - example`.

## Running a Deepnote Project

To run a Deepnote project, you can use any of the ways mentioned above (except JupyterLab, which is currently read-only).

To run this example, follow these steps:

1. To run the block, click the `Run` button or press `Cmd+Enter` on Mac or `Ctrl+Enter` on Windows.
2. If it is your first time running the block, you will be prompted to select a kernel so select `Python 3.10`.
3. The code should run and you should see `Hello world!` in the output panel.

## What's next?

You can have a look at [/examples](./examples) folder where you can find:

- [Getting started with Deepnote in VS Code](./examples/Getting%20started%20with%20Deepnote%20in%20VS%20Code/Readme.md) which is more in-depth guide on how to use Deepnote in VS Code.
- [2_housing_prices_prediction](./examples/2_housing_prices_prediction.deepnote) where you try out some machine learning and data science.
- And [our demo](./examples/demo.deepnote), which is demo project showcasing all features of Deepnote.

## Need help?

- Join our [Community](https://github.com/deepnote/deepnote/discussions)!
- [Open an issue](https://github.com/deepnote/deepnote/issues/new) for bug reports or feature requests
- Check out source code of related repositories: [Deepnote VS Code extension](https://github.com/deepnote/vscode-deepnote), [Deepnote JupyterLab extension](https://github.com/deepnote/jupyterlab-deepnote) and [Deepnote Toolkit](https://github.com/deepnote/deepnote-toolkit).
- Check out our [documentation](https://deepnote.com/docs?utm_source=github&utm_medium=github&utm_campaign=github&utm_content=readme_main)
- Want a low-code experience? Visit [Deepnote Cloud](https://deepnote.com/?utm_source=github&utm_medium=github&utm_campaign=github&utm_content=readme_main) together with Deepnote AI agent
