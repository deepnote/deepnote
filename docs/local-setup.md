---
title: How to set up Deepnote locally
description: Learn how to work with Deepnote notebooks on your local machine using VS Code, Cursor, or custom implementations.
noIndex: false
noContent: false
---

# How to set up Deepnote locally

Deepnote notebooks can be used locally on your machine in several ways, each offering different levels of functionality and integration. This guide covers all available options for working with `.deepnote` files outside of the Deepnote cloud platform.

## Overview of local options

| Method                                        | Best For                  | Execution | Editing | Difficulty |
| --------------------------------------------- | ------------------------- | --------- | ------- | ---------- |
| **VS Code/Cursor/Windsurf extensions**        | Full-featured development | ✅ Yes    | ✅ Yes  | Easy       |
| **Deepnote Toolkit**                          | Custom implementations    | ✅ Yes    | ✅ Yes  | Advanced   |
| **Local Singleplayer <br></br>(coming soon)** | Local AI IDE              | ✅ Yes    | ✅ Yes  | Easy       |

## 🚀 VS Code, Cursor, and Windsurf extensions (recommended)

The **Deepnote extension** is available for **VS Code**, **Cursor**, and **Windsurf**, providing the most complete local experience with full support for editing, execution, and Deepnote-specific features across all three AI-native code editors.

### Features

- ✅ **Full editing capabilities** - Edit code, markdown, and SQL blocks
- ✅ **Execute notebooks** - Run Python code and SQL queries locally
- ✅ **Database integrations** - Connect to PostgreSQL, BigQuery, Snowflake, and more
- ✅ **Multiple block types** - Work with code, SQL, markdown, and specialized blocks
- ✅ **Init notebooks** - Automatic initialization code execution
- ✅ **Secure credentials** - Encrypted storage using VS Code's SecretStorage API
- ✅ **Project explorer** - Browse and manage multiple notebooks

### Installation

Choose your preferred editor and install the extension:

#### VS Code

- **[Install from VS Code Marketplace →](https://marketplace.visualstudio.com/items?itemName=Deepnote.vscode-deepnote)**
- Or use Quick Open: `Cmd+P` / `Ctrl+P` → `ext install Deepnote.vscode-deepnote`
- Requires VS Code 1.103.0 or higher

#### Cursor

- **[Install from Open VSX Registry →](https://open-vsx.org/extension/Deepnote/vscode-deepnote)**
- Or search for "Deepnote" in Cursor's extension marketplace

#### Windsurf

- **[Install from Open VSX Registry →](https://open-vsx.org/extension/Deepnote/vscode-deepnote)**
- Or search for "Deepnote" in Windsurf's extension marketplace

**Additional requirement**: Python 3.10 or higher

### Getting started

1. **Open a folder** containing `.deepnote` project files
2. **Find the Deepnote icon** in the Activity Bar (sidebar)
3. **Click on a notebook** in the Deepnote Explorer to open it
4. **Select a Python kernel** when prompted
5. **Start coding!**

### Working with database integrations

Configure database connections for SQL blocks:

1. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run `Deepnote: Manage Integrations`
3. Add your database credentials (PostgreSQL, BigQuery, etc.)
4. Use SQL blocks in your notebooks with the configured integrations

**Security Note**: Credentials are securely stored using your editor's encrypted storage and never leave your machine.

### Example SQL block

```sql
-- Query your PostgreSQL database
SELECT * FROM users WHERE created_at > '2024-01-01'
LIMIT 100
```

Results are displayed as interactive tables that you can explore and export.

### Available commands

Open the Command Palette and type `Deepnote` to see all available commands:

- `Deepnote: Refresh explorer` - Refresh the project explorer
- `Deepnote: Open notebook` - Open a specific notebook
- `Deepnote: Open file` - Open the raw .deepnote file
- `Deepnote: Reveal in explorer` - Show active notebook in explorer
- `Deepnote: Manage integrations` - Configure database connections
- `Deepnote: New project` - Create a new Deepnote project
- `Deepnote: Import notebook` - Import existing notebooks

### Learn more

- [GitHub repository](https://github.com/deepnote/vscode-deepnote)
- [Architecture documentation](https://github.com/deepnote/vscode-deepnote/blob/main/architecture.md)
- [Contributing guide](https://github.com/deepnote/vscode-deepnote/blob/main/CONTRIBUTING.md)

## Deepnote Toolkit (advanced)

The **Deepnote Toolkit** is a Python package that provides the underlying infrastructure for running Deepnote notebooks locally. This is an advanced option for developers who want to build custom implementations or deeply integrate Deepnote into their workflows.

### What is the Deepnote Toolkit?

The toolkit is the core Python package that powers Deepnote's execution environment. It includes:

- **Python kernel** with scientific computing libraries
- **SQL support** with query caching
- **Data visualization** (Altair, Plotly)
- **Streamlit apps** support with auto-reload
- **Language Server Protocol** integration
- **Git integration** with SSH/HTTPS authentication
- **Integration environment variables** management

### When to use the Toolkit

Consider using the Deepnote Toolkit if you:

- ✅ Want to build custom notebook execution environments
- ✅ Need to integrate Deepnote notebooks into existing Python applications
- ✅ Are developing extensions or tools for Deepnote
- ✅ Want full control over the execution environment
- ✅ Need to customize the notebook runtime behavior

### Installation

**Requirements:**

- Python 3.10+
- Poetry (for dependency management)
- Java 11 (for PySpark features)

**Install the toolkit:**

```bash
# Install with pip
pip install deepnote-toolkit

# Or with Poetry
poetry add deepnote-toolkit
```

### CLI quick start

The toolkit includes a command-line interface for running Jupyter servers:

```bash
# Start Jupyter server on default port (8888)
deepnote-toolkit server

# Start with custom configuration
deepnote-toolkit server --jupyter-port 9000

# View configuration
deepnote-toolkit config show

# Modify configuration
deepnote-toolkit config set server.jupyter_port 9000
```

**Security Warning**: The CLI will warn if Jupyter runs without authentication. This is intended for local development only. Set `DEEPNOTE_JUPYTER_TOKEN` for shared environments.

### Using in Python Code

```python
from deepnote_toolkit import DeepnoteKernel
from deepnote_toolkit.sql import execute_sql

# Execute SQL queries
result = execute_sql(
    query="SELECT * FROM users LIMIT 10",
    connection_string="postgresql://localhost/mydb"
)

# Use Deepnote components
from deepnote_toolkit.components import DataTable
DataTable(result)
```

### Development setup

For developers who want to contribute or customize the toolkit, see the [Contributing Guide](https://github.com/deepnote/deepnote-toolkit/blob/main/CONTRIBUTING.md) for detailed setup instructions including Docker development.

### Advanced features

The toolkit provides access to advanced Deepnote features:

- **Query caching** - Automatic SQL query result caching
- **Data catalogs** - Integration with data catalog systems
- **Custom visualizations** - Build custom chart types
- **Streamlit integration** - Run Streamlit apps within notebooks
- **Feature flags** - Control feature availability

### Learn More

- [GitHub Repository](https://github.com/deepnote/deepnote-toolkit)
- [API Documentation](https://github.com/deepnote/deepnote-toolkit/tree/main/docs)
- [Contributing Guide](https://github.com/deepnote/deepnote-toolkit/blob/main/README.md#development-workflow)

## 🔮 Local singleplayer (coming soon)

We're working on a **Local Singleplayer** experience that will provide a complete, standalone Deepnote environment running entirely on your local machine.

### Stay updated

Want to be notified when Local Singleplayer launches?

- ⭐ Star the [Deepnote GitHub repository](https://github.com/deepnote/deepnote)
- 📧 Sign up for updates at [deepnote.com](https://deepnote.com)
- 💬 Join the discussion in [GitHub Discussions](https://github.com/deepnote/deepnote/discussions)

## Comparison Matrix

### Feature Comparison

| Feature                     | VS Code/Cursor/Windsurf Extensions | Deepnote Toolkit | Local Singleplayer\* |
| --------------------------- | ---------------------------------- | ---------------- | -------------------- |
| **View notebooks**          | ✅                                 | ✅               | ✅                   |
| **Edit notebooks**          | ✅                                 | ✅               | ✅                   |
| **Execute code**            | ✅                                 | ✅               | ✅                   |
| **SQL blocks**              | ✅                                 | ✅               | ✅                   |
| **Database integrations**   | ✅                                 | ✅               | ✅                   |
| **Real-time collaboration** | ❌                                 | ❌               | ❌                   |
| **Deepnote UI**             | ❌                                 | ❌               | ✅                   |
| **Offline mode**            | ✅                                 | ✅               | ✅                   |
| **Custom integrations**     | ⚠️ Limited                         | ✅               | ✅                   |
| **AI features**             | ❌                                 | ❌               | ✅                   |

\*Coming soon

## Getting help

If you encounter issues with any local setup option:

1. **Check the documentation** for the specific tool you're using
2. **Search existing issues** on the relevant GitHub repository
3. **Ask in GitHub Discussions** for community support
4. **Open an issue** with detailed information about your environment

### Useful links

- [Deepnote community](https://github.com/deepnote/deepnote/discussions)
- [Deepnote Documentation](https://deepnote.com/docs)
- [VS Code Extension Issues](https://github.com/deepnote/vscode-deepnote/issues)
- [Deepnote Toolkit Issues](https://github.com/deepnote/deepnote-toolkit/issues)

**Note**: This documentation covers open-source and local development options. For the full cloud-based Deepnote experience with real-time collaboration, AI features, and managed infrastructure, visit [deepnote.com](https://deepnote.com).
