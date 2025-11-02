<div align="center">

![Deepnote logo full dark](/assets/deepnote-cover-image.png)

[![CI](https://github.com/deepnote/deepnote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/deepnote/deepnote/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/deepnote/deepnote/graph/badge.svg?token=7DHBMXZS28)](https://codecov.io/gh/deepnote/deepnote)

[Website](https://deepnote.com/?utm_source=github&utm_medium=github&utm_campaign=github&utm_content=readme_main) • [Docs](https://deepnote.com/docs?utm_source=github&utm_medium=github&utm_campaign=github&utm_content=readme_main) • [Changelog](https://deepnote.com/changelog?utm_source=github&utm_medium=github&utm_campaign=github&utm_content=readme_main) • [X](https://x.com/DeepnoteHQ) • [Examples](https://deepnote.com/explore?utm_source=github&utm_medium=github&utm_campaign=github&utm_content=readme_main) • [Community](https://github.com/deepnote/deepnote/discussions)

</div>

# Deepnote data notebook for new era

Deepnote is a drop-in replacement for Jupyter with AI-first design, sleek UI, new blocks, and native data integrations. Use Deepnote Open Source to work locally in your favorite IDE, then scale to Deepnote Cloud for real-time collaboration, governance, and deployable data apps. Deepnote is used by 500,000 data professionals and companies like Estée Lauder, Soundcloud, Statsig, Gusto, and beyond.

Get started with Deepnote in seconds:

```bash
npx @deepnote/convert notebook.ipynb #this gets converted into notebook.deepnote
```

Then open your `.deepnote` file in [VS Code](https://marketplace.visualstudio.com/items?itemName=Deepnote.vscode-deepnote), [Cursor](https://open-vsx.org/extension/Deepnote/vscode-deepnote), [Windsurf](https://open-vsx.org/extension/Deepnote/vscode-deepnote), or [JupyterLab](https://pypi.org/project/jupyterlab-deepnote/)!

## What is Deepnote?

Deepnote Open Source is an AI notebook, built with collaboration and the next decade in mind. It's pretty, AI-first, has countless data and ecosystem integrations, and offers you everything you'd need to work locally before you scale your workflows in a team with Deepnote Cloud.

### Why Deepnote Open Source?

- **Human-readable format** – The .deepnote YAML format replaces ipynb's messy JSON with clean, version-control and human-friendly structure for projects and notebooks. You can organize multiple notebooks, integrations, and settings into a single .deepnote project for better structure and collaboration.
- **Block-based architecture** – Extend notebooks beyond code cells with blocks for SQL, inputs, charts, and much more — all defined and validated through the open `@deepnote/blocks` package.
- **Work wherever** – Run notebooks locally in VS Code, JupyterLab, or anywhere else with the open-source Deepnote Toolkit. Once you want to work in a team on the same notebook with beefier compute - drag and drop your project into Deepnote Cloud.
- **Reactive notebook execution** – Automatically re-runs dependent blocks when inputs or data change, ensuring notebooks stay consistent and reproducible without manual execution.
- **Open and extendable** – Built on the Jupyter kernel for full compatibility with your existing notebooks.
- **Effortless conversion** – Convert .ipynb notebooks into .deepnote projects and back again using the open `@deepnote/convert` CLI and API.

## What can you do right now?

This open-source repository lets you, edit and run Deepnote notebooks directly in your favorite AI-native code editors:

- **[VS Code extension](https://marketplace.visualstudio.com/items?itemName=Deepnote.vscode-deepnote)** - Full Deepnote support in Visual Studio Code
- **[Cursor extension](https://open-vsx.org/extension/Deepnote/vscode-deepnote)** - AI-powered notebook editing in Cursor
- **[Windsurf extension](https://open-vsx.org/extension/Deepnote/vscode-deepnote)** - Collaborative development in Windsurf
- **[JupyterLab extension](https://pypi.org/project/jupyterlab-deepnote/)** - Read `.deepnote` files in JupyterLab with backwards compatibility

## Deepnote vs. Jupyter

Deepnote keeps the same Jupyter core so you can seamlessly move between both, but adds an AI-first design, sleek UI, new blocks, data integrations—so you never have to maintain or rebuild these pieces yourself.

| Feature             | Deepnote                          | Jupyter                     |
| ------------------- | --------------------------------- | --------------------------- |
| **Setup**           | Zero setup, cloud-based           | Local installation required |
| **AI Features**     | Native AI Copilot                 | Third-party extensions      |
| **Version control** | Built-in Git integration          | Manual Git workflow         |
| **Sharing**         | Share with a link                 | Export files manually       |
| **Compute**         | Managed cloud compute             | Local resources only        |
| **Integrations**    | Native database & API connections | Manual configuration        |

## What's inside this repository

Reusable packages and libraries powering Deepnote's notebook, runtime, and collaboration features.

**[@deepnote/blocks](./packages/blocks)** TypeScript types and utilities for working with Deepnote notebook blocks.

- **Block type definitions**: Code, SQL, Text, Markdown, Input, Visualization, Button, Big Number, Image, Separator
- **Python code generation**: Convert blocks to executable Python code
- **Markdown conversion**: Convert text blocks to/from markdown format
- **Input block support**: Text, textarea, checkbox, select, slider, file, date, and date-range inputs

**[@deepnote/convert](./packages/convert)** CLI tool and library to convert Jupyter notebooks (`.ipynb`) to Deepnote format (`.deepnote`).

- **CLI tool**: `deepnote-convert` command for batch conversions
- **Programmatic API**: Use in Node.js/TypeScript applications
- **Directory support**: Convert entire folders of notebooks
- **Custom projects**: Set metadata during conversion

## Coming soon - local use

In couple of weeks/months you'll be able to:

- Run single-player Deepnote locally
- Edit notebooks with local AI agent
- Bring your own keys for AI services
- Run your own compute

## Deepnote for academia

Deepnote Cloud is **free for students and educators**! Get unlimited access to all core features, cloud compute, and real-time collaboration for your research and teaching.
If you use Deepnote in your research, please cite Deepnote using:

```latex
@misc{deepnote,
    title = {Deepnote: the data notebook for the AI era},
    author = {Johnny Carrot},
    year = {2025},
    url = {https://github.com/deepnote/deepnote},
    note = {Open-source collaborative data science notebook platform}
}
```

**Learn more:** [deepnote.com/education](https://deepnote.com/education?utm_source=github&utm_medium=github&utm_campaign=github&utm_content=readme_main)

## Need help?

- Join our [Community](https://github.com/deepnote/deepnote/discussions)!
- [Open an issue](https://github.com/deepnote/deepnote/issues/new) for bug reports or feature requests
- Check out source code of related repositories: [Deepnote VS Code extension](https://github.com/deepnote/vscode-deepnote), [Deepnote JupyterLab extension](https://github.com/deepnote/jupyterlab-deepnote) and [Deepnote Toolkit](https://github.com/deepnote/deepnote-toolkit).
- Check out our [documentation](https://deepnote.com/docs?utm_source=github&utm_medium=github&utm_campaign=github&utm_content=readme_main)
- Want a low-code experience? Visit [Deepnote Cloud](https://deepnote.com/?utm_source=github&utm_medium=github&utm_campaign=github&utm_content=readme_main) together with Deepnote AI agent

## Contributing

We love external contributors! Whether you're fixing bugs, adding features, or improving documentation, your contributions are welcome, please see [CONTRIBUTING.md](CONTRIBUTING.md), or join [our team](https://deepnote.com/careers)

## Acknowledgements

We owe a huge thank-you to the Jupyter community and everyone who has contributed to open notebooks over the past decade. Jupyter set the standard for how the world explores data and shares ideas through code when it launched in 2013. Deepnote builds directly on that legacy — and extends it into the AI-native, collaborative future. None of this would exist without the foundations Jupyter created, and we’re proud to keep contributing back to the same open ecosystem.

---

<div align="center">

Built with 💙 by the data-driven team.

</div>
