---
title: Deepnote CLI
description: Install the Deepnote CLI and use it to run, inspect, convert, sync and publish Deepnote projects from your terminal
noIndex: false
noContent: false
---

The Deepnote CLI is a command-line tool for working with Deepnote projects outside the browser. It
reads and writes the open [`.deepnote` file format](/docs/deepnote-format), runs notebooks locally
or in Deepnote Cloud, mirrors a whole workspace to your machine, and deploys static sites to a
project. It is open source and lives in the
[deepnote/deepnote](https://github.com/deepnote/deepnote/tree/main/packages/cli) repository.

```bash
npm install -g @deepnote/cli
deepnote --help
```

Use the CLI when you want to:

- **Run notebooks from scripts, cron jobs or CI** instead of clicking Run in the editor.
- **Keep notebooks in Git** and inspect, diff, lint or validate `.deepnote` files in pull requests.
- **Convert** between `.ipynb`, `.py`, `.qmd` and `.deepnote`.
- **Mirror your workspace locally** with [`deepnote sync`](/docs/deepnote-cli-sync) and push edits
  back.
- **Deploy a built static site** to a project with [`deepnote publish`](/docs/deepnote-cli-publish).
- **Give AI coding assistants** the Deepnote file format and CLI reference with
  `deepnote install-skills`.

<Callout status="info">
The CLI is under active development. Commands and output formats may change between minor
versions; check the [changelog on npm](https://www.npmjs.com/package/@deepnote/cli) when upgrading.
</Callout>

## Installation

The CLI is published to npm as `@deepnote/cli` and runs on Node.js.

```bash
npm install -g @deepnote/cli
# or
pnpm add -g @deepnote/cli
# or run it without installing
npx @deepnote/cli --help
```

If you would rather not install Node.js, `pip install deepnote-cli` bundles a native binary and
exposes the same `deepnote` command.

Running notebooks locally with `deepnote run` additionally needs a Python interpreter with the
[deepnote-toolkit](https://pypi.org/project/deepnote-toolkit/) package
(`pip install "deepnote-toolkit[server]"`). The CLI picks up a `.venv` or `venv` next to the notebook
automatically, or point it at an interpreter with `--python`.

## Authentication

Commands that talk to Deepnote Cloud (`run --cloud`, `open`, `schedule`, `sync`, `publish`,
`static-site access`, `integrations pull`) need an API key. Create one in your workspace under
**Settings & members → Security → API keys** (see the [Deepnote API docs](/docs/deepnote-api)) and
pass it in one of three ways:

| Method               | Example                                            | When to use                              |
| -------------------- | -------------------------------------------------- | ---------------------------------------- |
| Environment variable | `export DEEPNOTE_TOKEN="<your-token>"`             | Interactive shells, CI secrets           |
| `.env` file          | `DEEPNOTE_TOKEN=<your-token>` in `.env`            | Project directories you sync or run from |
| `--token` flag       | `deepnote sync ./workspace --token "<your-token>"` | One-off commands                         |

Prefer the environment variable or a `.env` file: a token passed as `--token` ends up in your shell
history. Without a token, cloud commands exit with code `2` and print these options.

Local-only commands such as `inspect`, `cat`, `lint`, `convert` and `run` without `--cloud` never
contact Deepnote and need no token.

## Commands

| Command                                                | What it does                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `deepnote run [path]`                                  | Run a `.deepnote`, `.ipynb`, `.py` or `.qmd` file locally, or in Deepnote Cloud with `--cloud` |
| `deepnote inspect [path]`                              | Show project metadata: name, ID, notebooks and block counts                                    |
| `deepnote cat <path>`                                  | Print block contents, optionally filtered by notebook or block type                            |
| `deepnote diff <path1> <path2>`                        | Compare two `.deepnote` files and show structural differences                                  |
| `deepnote lint [path]`                                 | Check for undefined variables, circular dependencies, missing integrations and inputs          |
| `deepnote validate <path>`                             | Validate a `.deepnote` file against the schema                                                 |
| `deepnote stats <path>`                                | Block counts, lines of code and imported modules                                               |
| `deepnote analyze <path>`                              | Quality score, structure analysis and suggestions                                              |
| `deepnote dag show\|vars\|downstream <path>`           | Analyze block dependencies and variable flow                                                   |
| `deepnote convert <path>`                              | Convert between `.ipynb`, `.py`, `.qmd` and `.deepnote`                                        |
| `deepnote split <path>`                                | Split a multi-notebook `.deepnote` file into one file per notebook                             |
| `deepnote open <path>`                                 | Upload a `.deepnote` file to Deepnote Cloud and open it in the browser                         |
| `deepnote schedule <path>`                             | Create or update a recurring run in Deepnote Cloud                                             |
| [`deepnote sync [dir]`](/docs/deepnote-cli-sync)       | Mirror your workspace to a local directory and push notebook edits back                        |
| [`deepnote publish <dir>`](/docs/deepnote-cli-publish) | Deploy a local build directory as a static site hosted by a project                            |
| `deepnote static-site access`                          | Enable or disable access to a published static site without redeploying                        |
| `deepnote integrations pull\|add\|edit`                | Manage the local database integrations file used by `run`                                      |
| `deepnote install-skills`                              | Install the Deepnote skill for Claude Code, Cursor and other AI coding assistants              |
| `deepnote completion <shell>`                          | Generate shell completion scripts                                                              |

Every command accepts `--help`. The full reference with all options, output schemas and examples is
the [package README on npm](https://www.npmjs.com/package/@deepnote/cli).

### Examples

```bash
# Run the first .deepnote file in the current directory
deepnote run

# Run a notebook in Deepnote Cloud with an input value
DEEPNOTE_TOKEN=... deepnote run report.deepnote --cloud --input name="Alice"

# Convert a Jupyter notebook to the Deepnote format
deepnote convert notebook.ipynb

# Check a project for issues before committing it
deepnote lint my-project.deepnote

# Schedule a daily run in Deepnote Cloud
deepnote schedule report.deepnote --daily --at 09:00

# Mirror your whole workspace to ./workspace
deepnote sync ./workspace

# Publish a Vite build to a project
deepnote publish ./dist --project-id <project-id>
```

## Scripting and automation

The CLI is designed to be driven by scripts and AI agents.

- **Exit codes** are consistent across commands: `0` success, `1` runtime error, `2` invalid usage
  (bad arguments, missing file, missing token).
- **Machine-readable output** is available with `-o json` on most commands. `-o toon` emits
  [TOON](https://toonformat.dev/), a compact format for LLMs, and `-o llm` picks the best of the two
  for each command.
- **`-q, --quiet`** suppresses progress output; errors still go to stderr.
- **Colors** follow the [NO_COLOR](https://no-color.org/) and [FORCE_COLOR](https://force-color.org/)
  conventions, and `--no-color` disables them explicitly.

```bash
# Fail a CI step if the notebook has lint errors
deepnote lint my-project.deepnote -o json || exit 1
```

## Related

- [Syncing a workspace with the Deepnote CLI](/docs/deepnote-cli-sync)
- [Publishing static sites with the Deepnote CLI](/docs/deepnote-cli-publish)
- [Deepnote file format](/docs/deepnote-format) — what is inside a `.deepnote` file
- [Deepnote file sync](/docs/deepnote-file-sync) — the in-product Git-linked feature
- [Deepnote API](/docs/deepnote-api) — the HTTP API the CLI talks to
- [Deepnote MCP](/docs/deepnote-mcp) — connect AI agents to your workspace
