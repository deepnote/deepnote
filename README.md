![Deepnote dragon](deepnote-dragon.png)

[![CI](https://github.com/deepnote/deepnote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/deepnote/deepnote/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/deepnote/deepnote/graph/badge.svg?token=7DHBMXZS28)](https://codecov.io/gh/deepnote/deepnote)

Welcome to the official open-source mono-repo for [Deepnote](https://deepnote.com)! This repository provides everything you need to explore, extend, and contribute to the Deepnote ecosystem — including core packages for notebook conversion, block definitions, dev tooling, and integrations with the broader computational notebook world.

**Key features:**
- 🔄 Convert Jupyter notebooks to Deepnote format
- 📦 TypeScript SDK for Deepnote blocks and notebook structure
- 🐍 Python code generation from notebook blocks
- 🔌 Integrations with VS Code, Cursor, Windsurf, and JupyterLab

---

## 🚀 What's inside

## 📦 COMING SOON - Local use

Soon you'll be able to clone the repo, install dependencies and run the dockerised Deepnote locally with no other setup required:

```bash
git clone https://github.com/deepnote/deepnote.git
cd deepnote
pnpm install
pnpm start
```

### 📦 TypeScript packages

Reusable packages and libraries powering Deepnote's notebook, runtime, and collaboration features.

#### **[@deepnote/blocks](./packages/blocks)**

TypeScript types and utilities for working with Deepnote notebook blocks.

- **Block Type Definitions**: Code, SQL, Text, Markdown, Input, Visualization, Button, Big Number, Image, Separator
- **Python Code Generation**: Convert blocks to executable Python code
- **Markdown Conversion**: Convert text blocks to/from markdown format
- **Input Block Support**: Text, textarea, checkbox, select, slider, file, date, and date-range inputs

```typescript
import { createPythonCode, createMarkdown } from '@deepnote/blocks';
```

#### **[@deepnote/convert](./packages/convert)**

CLI tool and library to convert Jupyter notebooks (`.ipynb`) to Deepnote format (`.deepnote`).

- **CLI Tool**: `deepnote-convert` command for batch conversions
- **Programmatic API**: Use in Node.js/TypeScript applications
- **Directory Support**: Convert entire folders of notebooks
- **Custom Project Names**: Set metadata during conversion

```bash
npm install -g @deepnote/convert
deepnote-convert notebook.ipynb --projectName "My Analysis"
```

### 🐍 Python packages

- **[deepnote-toolkit](https://github.com/deepnote/deepnote-toolkit)** - Python kernel extensions and integrations for Deepnote (separate repository)

### 🌐 Ecosystem integrations

Deepnote integrates with popular development environments and notebook platforms:

#### AI-native code editors

- 🖥️ **[VS Code extension](https://github.com/deepnote/vscode-deepnote)** - Edit and run Deepnote notebooks in Visual Studio Code
- ✏️ **[Cursor extension](https://github.com/deepnote/vscode-deepnote)** - AI-powered notebook editing in Cursor
- 🌊 **[Windsurf extension](https://github.com/deepnote/vscode-deepnote)** - Collaborative notebook development in Windsurf

#### Notebook platforms

- 🧪 **[JupyterLab extension](https://github.com/deepnote/jupyterlab-deepnote)** - Read and edit `.deepnote` files in JupyterLab with full backwards compatibility

## 🛠️ Contributing

We love external contributors! Whether you're fixing bugs, adding features, or improving documentation, your contributions are welcome.

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup instructions
- Code style guidelines
- Testing requirements
- Pull request process

## 🙌 Need help?

- 💬 [Open an issue](https://github.com/deepnote/deepnote/issues/new) for bug reports or feature requests
- 📖 Check out our [documentation](https://deepnote.com/docs)
- 🌐 Visit [deepnote.com](https://deepnote.com) to try Deepnote

## 📄 License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.

---

<div align="center">

**Built with ❤️ by the Deepnote team**

[Website](https://deepnote.com) • [Documentation](https://deepnote.com/docs) • [Blog](https://deepnote.com/blog) • [Twitter](https://twitter.com/deepnoteapp)

</div>
