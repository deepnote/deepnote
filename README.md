![Deepnote dragon](deepnote-dragon.png)

<div align="center">

[![CI](https://github.com/deepnote/deepnote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/deepnote/deepnote/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/deepnote/deepnote/graph/badge.svg?token=7DHBMXZS28)](https://codecov.io/gh/deepnote/deepnote)

[Website](https://deepnote.com) • [Documentation](https://deepnote.com/docs) • [Blog](https://deepnote.com/blog) • [Twitter](https://twitter.com/deepnoteapp) • [Explore](https://deepnote.com/explore) • [Community]()

</div>

---

## 🚀 Quick start

Get started with Deepnote in seconds:

```bash
# Install the converter
npm install -g @deepnote/convert

# Convert your Jupyter notebook
deepnote-convert notebook.ipynb --projectName "My Analysis"

# Or use it programmatically
npx @deepnote/convert notebook.ipynb
```

Then open your `.deepnote` file in [VS Code](https://github.com/deepnote/vscode-deepnote), [Cursor](https://github.com/deepnote/vscode-deepnote), [Windsurf](https://github.com/deepnote/vscode-deepnote), or [JupyterLab](https://github.com/deepnote/jupyterlab-deepnote)!

---

## 🌟 What is Deepnote?

Deepnote is a **collaborative data science notebook** built for modern teams. Unlike traditional notebooks, Deepnote combines the best of Jupyter with real-time collaboration, AI assistance, and seamless integrations — all in one platform.

### Why Deepnote?

- **🤝 Real-time collaboration** - Like Google Docs for notebooks with comments and sharing
- **🤖 AI-native** - Built-in Copilot that understands your data and generates code
- **🔗 Seamless integrations** - Connect to databases, VS Code, Cursor, Windsurf, JupyterLab
- **⚡ Production-ready** - Git integration, scheduled runs, and enterprise security

---

## 🎯 What can you do right now?

This open-source repository lets you:

### 🖥️ **Use Deepnote in VS Code, Cursor, and Windsurf**

Edit and run Deepnote notebooks directly in your favorite AI-native code editors:

- 🖥️ **[VS Code extension](https://github.com/deepnote/vscode-deepnote)** - Full Deepnote support in Visual Studio Code
- ✏️ **[Cursor extension](https://github.com/deepnote/vscode-deepnote)** - AI-powered notebook editing in Cursor
- 🌊 **[Windsurf extension](https://github.com/deepnote/vscode-deepnote)** - Collaborative development in Windsurf

### 🧪 **Use Deepnote in JupyterLab**

- 🧪 **[JupyterLab extension](https://github.com/deepnote/jupyterlab-deepnote)** - Read and edit `.deepnote` files in JupyterLab with full backwards compatibility

### 🔄 **Convert Jupyter notebooks to Deepnote format**

```bash
npm install -g @deepnote/convert
deepnote-convert notebook.ipynb
```

### 📦 **Build with Deepnote's TypeScript SDK**

```typescript
import { createPythonCode, createMarkdown } from '@deepnote/blocks';
// Work with Deepnote blocks programmatically
```

---

## 📊 Deepnote vs. Others

### Deepnote vs. Marimo

| Feature | Deepnote | Marimo |
|---------|----------|--------|
| **Collaboration** | Real-time multiplayer | Single user |
| **AI Integration** | Built-in AI Copilot | No AI features |
| **Database Connections** | 20+ native integrations | Manual setup |
| **Deployment** | One-click sharing & scheduling | Local only |
| **Language Support** | Python, SQL, R | Python only |
| **Editor Support** | VS Code, Cursor, Windsurf, JupyterLab | Terminal-based |

### Deepnote vs. Jupyter

| Feature | Deepnote | Jupyter |
|---------|----------|---------|
| **Collaboration** | Real-time multiplayer | Manual sharing |
| **Setup** | Zero setup, cloud-based | Local installation required |
| **AI Features** | Native AI Copilot | Third-party extensions |
| **Version control** | Built-in Git integration | Manual Git workflow |
| **Sharing** | Share with a link | Export files manually |
| **Compute** | Managed cloud compute | Local resources only |
| **Integrations** | Native database & API connections | Manual configuration |

---

## 🚀 What's inside this repository

### 📦 TypeScript packages

Reusable packages and libraries powering Deepnote's notebook, runtime, and collaboration features.

#### **[@deepnote/blocks](./packages/blocks)**

TypeScript types and utilities for working with Deepnote notebook blocks.

- **Block type definitions**: Code, SQL, Text, Markdown, Input, Visualization, Button, Big Number, Image, Separator
- **Python code generation**: Convert blocks to executable Python code
- **Markdown conversion**: Convert text blocks to/from markdown format
- **Input block support**: Text, textarea, checkbox, select, slider, file, date, and date-range inputs

```typescript
import { createPythonCode, createMarkdown } from '@deepnote/blocks';
```

#### **[@deepnote/convert](./packages/convert)**

CLI tool and library to convert Jupyter notebooks (`.ipynb`) to Deepnote format (`.deepnote`).

- **CLI tool**: `deepnote-convert` command for batch conversions
- **Programmatic API**: Use in Node.js/TypeScript applications
- **Directory support**: Convert entire folders of notebooks
- **Custom projects**: Set metadata during conversion

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

---

## 📦 Coming Soon - Local Use

Soon you'll be able to clone the repo, install dependencies and run the dockerised Deepnote locally with no other setup required:

```bash
git clone https://github.com/deepnote/deepnote.git
cd deepnote
pnpm install
pnpm start
```

---

## 🎓 For students and academics

Deepnote is **free for students and educators**! Get unlimited access to all core features, cloud compute, and real-time collaboration for your research and teaching.

**Learn more and apply:** [deepnote.com/education](https://deepnote.com/education)

---

## 🙌 Need help?

- [Community]()
- 💬 [Open an issue](https://github.com/deepnote/deepnote/issues/new) for bug reports or feature requests
- 📖 Check out our [documentation](https://deepnote.com/docs)
- 🌐 Visit [deepnote.com](https://deepnote.com) to try Deepnote

---

## 🛠️ Contributing

We love external contributors! Whether you're fixing bugs, adding features, or improving documentation, your contributions are welcome.

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup instructions
- Code style guidelines
- Testing requirements
- Pull request process

---

## 📄 License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.

---

<div align="center">

**Built with ❤️ by the Deepnote team**

</div>
