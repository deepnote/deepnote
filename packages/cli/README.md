# @deepnote/cli

Command-line interface for running Deepnote projects locally and on Deepnote Cloud.

> **Note:** This project is under active development and is not ready for production use. Expect breaking changes.

## Installation

```bash
npm install -g @deepnote/cli
# or
pnpm add -g @deepnote/cli
# or
yarn global add @deepnote/cli
# or
pip install deepnote-cli
```

## Quick Start

```bash
# Show help
deepnote --help

# Show version
deepnote --version

# Sync your Deepnote workspace to a local directory (and push edits back)
deepnote sync workspace

# Run a project/notebook file (.deepnote, .ipynb, .py, .qmd)
deepnote run path/to/file.deepnote

# Inspect a .deepnote file
deepnote inspect path/to/file.deepnote

# Display block contents
deepnote cat my-project.deepnote

# Check for issues
deepnote lint my-project.deepnote

# Show project statistics
deepnote stats my-project.deepnote

# Validate a .deepnote file
deepnote validate path/to/file.deepnote

# Convert between notebook formats
deepnote convert notebook.ipynb

# Schedule recurring runs in Deepnote Cloud
deepnote schedule report.deepnote --daily --at 09:00

# Publish an app to an existing Deepnote project
deepnote publish ./dist --project-id <uuid>

# Stop serving it later without deleting its files
deepnote static-site access --project-id <uuid> --sharing disabled

# Serve a file already in the project as a Streamlit app
deepnote streamlit publish apps/dashboard.py --project-id <uuid>
```

## Commands

### `inspect [path]`

Inspect and display metadata from a `.deepnote` file.
Path is optional: when omitted, the CLI discovers the first `.deepnote` file in the current directory.

```bash
deepnote inspect my-project.deepnote
```

**Output includes:**

- File path and project name
- Project ID and file format version
- Creation, modification, and export timestamps
- Number of notebooks and blocks
- List of notebooks with their block counts

**Options:**

| Option               | Description                             | Default |
| -------------------- | --------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json`, `toon`, or `llm` | text    |

**Examples:**

```bash
# Basic inspection
deepnote inspect my-project.deepnote

# Inspect first .deepnote file in current directory
deepnote inspect

# JSON output for scripting
deepnote inspect my-project.deepnote --output json

# TOON output for LLM consumption (30-60% fewer tokens)
deepnote inspect my-project.deepnote --output toon

# Use with jq to extract specific fields
deepnote inspect my-project.deepnote --output json | jq '.project.name'
```

### `cat <path>`

Display block contents from a `.deepnote` file, with optional filtering by notebook, block type, or tree view.

```bash
deepnote cat my-project.deepnote
```

**Options:**

| Option               | Description                                                       | Default |
| -------------------- | ----------------------------------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm`                                    | text    |
| `--notebook <name>`  | Show only blocks from the specified notebook                      |         |
| `--type <type>`      | Filter blocks by type: `code`, `sql`, `markdown`, `text`, `input` |         |
| `--tree`             | Show structure only without block content                         | `false` |

**Examples:**

```bash
# Display all blocks in a file
deepnote cat my-project.deepnote

# Show only code blocks
deepnote cat my-project.deepnote --type code

# Show blocks from a specific notebook
deepnote cat my-project.deepnote --notebook "Data Analysis"

# Show structure without content (tree view)
deepnote cat my-project.deepnote --tree

# Output as JSON for scripting
deepnote cat my-project.deepnote -o json
```

### `run [path]`

Run a project/notebook file locally. Supported formats: `.deepnote`, `.ipynb`, `.py`, `.qmd`.
Path is optional: when omitted, the CLI discovers the first `.deepnote` file in the current directory.

```bash
deepnote run my-project.deepnote
```

**Options:**

| Option                        | Description                                                                          | Default                    |
| ----------------------------- | ------------------------------------------------------------------------------------ | -------------------------- |
| `--python <path>`             | Path to Python interpreter or virtual environment                                    | auto-detected              |
| `--cwd <path>`                | Working directory for execution                                                      | file directory             |
| `--startup-timeout <seconds>` | Seconds allowed for each of the toolkit server and the kernel to become ready        | `120` and `30`             |
| `--block-timeout <seconds>`   | Interrupt a block and fail the run if it executes longer than this (local runs only) | unlimited                  |
| `--notebook <name>`           | Run only the specified notebook                                                      | all notebooks              |
| `--block <id>`                | Run only the specified block                                                         | all blocks                 |
| `-i, --input <key=val>`       | Set input variable value (can be repeated)                                           |                            |
| `--list-inputs`               | List input variables without running                                                 | `false`                    |
| `--prompt <text>`             | Run an LLM agent block with the given prompt (requires `OPENAI_API_KEY`)             |                            |
| `-o, --output <fmt>`          | Output format: `json`, `toon`, or `llm`                                              | text                       |
| `--dry-run`                   | Show execution plan without running                                                  | `false`                    |
| `--top`                       | Display resource usage (CPU/memory) during execution                                 | `false`                    |
| `--profile`                   | Show per-block timing and memory summary                                             | `false`                    |
| `--open`                      | Open project in Deepnote Cloud after successful execution                            | `false`                    |
| `--context`                   | Include analysis context in output (requires `-o json/toon/llm`)                     | `false`                    |
| `--cloud`                     | Run in Deepnote Cloud, then download the snapshot locally                            | `false`                    |
| `--notebook-id <uuid>`        | Cloud notebook id to run (with `--cloud`)                                            |                            |
| `--out <path>`                | Write the downloaded cloud snapshot to this exact path                               |                            |
| `--storage-mode <mode>`       | Project-storage access for a detached cloud run: `read-write`, `readonly`            | `read-write`               |
| `--timeout <seconds>`         | Max seconds to wait for a cloud run (with `--cloud`)                                 | `600`                      |
| `--push`                      | Push the local `.deepnote` blocks to the Deepnote notebook before running            | `false`                    |
| `--yes`                       | Skip the `--push` confirmation prompt                                                | `false`                    |
| `--url <url>`                 | API base URL                                                                         | `https://api.deepnote.com` |
| `--token <token>`             | Bearer token (or `DEEPNOTE_TOKEN` env var)                                           |                            |

For agent blocks, `--block-timeout` covers the whole agent loop, including model requests and tool calls. Generated Python blocks share the remaining time. Expiry cancels the agent and reports `execution-timeout`; cancellation waits for in-flight tool cleanup.

**Examples:**

```bash
# Run a .deepnote file (executes every notebook it contains)
deepnote run my-project.deepnote

# Run a Jupyter notebook directly (auto-converted)
deepnote run notebook.ipynb

# Run with a specific Python virtual environment
deepnote run my-project.deepnote --python path/to/venv

# Fail fast in CI: 60s for the runtime to start, 5 minutes per block
deepnote run my-project.deepnote --startup-timeout 60 --block-timeout 300 -o json

# Stream the toolkit server's own log while running
deepnote --debug run my-project.deepnote

# Run only a specific notebook
deepnote run my-project.deepnote --notebook "Data Analysis"

# Set input values for input blocks
deepnote run my-project.deepnote --input name="Alice" --input count=42

# Output results as JSON for CI/CD pipelines
deepnote run my-project.deepnote --output json

# Output results as TOON for LLM consumption
deepnote run my-project.deepnote --output toon

# Preview what would be executed without running
deepnote run my-project.deepnote --dry-run

# Run an existing notebook in Deepnote Cloud and download its snapshot
DEEPNOTE_TOKEN=... deepnote run --cloud --notebook-id 0f1e2d3c-4b5a-6789-abcd-ef0123456789

# Run a .deepnote (notebook id read from the file) in the cloud, with inputs
DEEPNOTE_TOKEN=... deepnote run my-project.deepnote --cloud --input name="Alice"

# Keep project storage read-only during a detached full-notebook run
DEEPNOTE_TOKEN=... deepnote run my-project.deepnote --cloud --storage-mode readonly

# Run an agent with a prompt (appends an agent block to the file)
OPENAI_API_KEY=sk-... deepnote run my-project.deepnote --prompt "Analyze the sales data"

# Run an agent block standalone (no file needed)
OPENAI_API_KEY=sk-... deepnote run --prompt "Write a hello world script"
```

Use plain strings for text, date, file, slider, and single-select inputs; use `true` or `false` for checkboxes; and use
JSON arrays of strings for multi-select inputs and absolute date ranges, for example
`--input regions='["US","EU"]'`. Unknown input names and invalid values are rejected.

These rules are the same for `--cloud` runs. Typing a value needs the notebook's input blocks, so
`--input` requires the local `.deepnote` file — pass the file rather than only `--notebook-id`.

Full-notebook cloud runs are detached: Deepnote executes a copy without updating outputs in the
live editor. Project files remain shared and writable by default. `--storage-mode readonly` makes
persistent project storage read-only for that run; temporary files and reads still work, and
databases, integrations, external APIs, and other systems remain live. Block-scoped cloud runs are
the exception: the API runs them in live mode, so they update live-editor outputs and cannot be
combined with `--storage-mode`.

`--push` sends the local file's blocks to the Deepnote notebook before the run, so the run executes
what is on disk rather than what was last saved in Deepnote. The sync is destructive — a cloud
block the file does not have is deleted, and a block whose type or metadata changed is recreated
under a new id (a `--block` selection is remapped automatically) — so the CLI prints the plan and
asks first. `--yes` confirms non-interactively and is required when output is piped or
machine-readable; `--dry-run` prints the plan and exits without sending or running anything (with
`-o json`/`-o toon` the plan itself is emitted); a declined confirmation exits `0` without running.

Cloud execution status and snapshot delivery are reported separately. The CLI briefly polls after
terminal status because snapshot attachment can lag; empty snapshot content is treated as no
snapshot. If an empty or markdown-only local notebook successfully produces no snapshot, the CLI
writes a valid output-free snapshot from the local source and marks it `artifactStatus:
synthesized`. Any other run that produces no snapshot — including a remote-only run by
`--notebook-id` — exits `1` with `artifactStatus: not_produced`; an advertised snapshot that
cannot be downloaded or saved reports `artifactStatus: unavailable` and exits `1`. `success` in
machine output means the run succeeded and its snapshot was delivered (`saved` or `synthesized`).

#### Runtime failures

A local run stops at the first failing block and never hangs: a kernel that dies, a toolkit server
that goes away mid-run, and a server that fails to start are all reported within seconds. With
`-o json` / `-o toon` the result carries `failureCategory` on the run and on the failed block, one of
`in-block` (the block's code raised), `kernel-died`, `execution-timeout` (see `--block-timeout`),
`server-exited`, `server-launch` (the toolkit is not installed for that Python, a server dependency
is missing, no port is free, or `--startup-timeout` elapsed) or `kernel-launch`. When the runtime
knows a remedy it adds `hint`; a startup failure emits `{ success: false, error, failureCategory, hint }`.
Without `--python`, the CLI also picks up a `.venv` or `venv` next to (or above) the notebook when
`deepnote-toolkit` is installed in it.

#### Agent Block (`--prompt` and agent blocks)

`--prompt` adds an agent block and runs the notebook. Without a file, it creates a new notebook.
The agent can read outputs, run Python, and add code and text blocks.

```bash
OPENAI_API_KEY=sk-... deepnote run my-project.deepnote --prompt "Analyze the sales data"
```

`--prompt` uses OpenAI with `OPENAI_MODEL`, or `gpt-6.1-sol` if unset. To use Claude or another
provider, set `metadata.deepnote_agent_model` on an existing agent block, such as `claude-opus-5-5`
with `ANTHROPIC_API_KEY`. See [agent block providers](../runtime-core/README.md#agent-block-providers)
for all providers and custom endpoints, and [Cloud model support](../runtime-core/README.md#sharing-notebooks-with-cloud).

The agent can also query configured database integrations using `deepnote-toolkit`.

### `lint <path>`

Check a `.deepnote` file for issues including undefined variables, circular dependencies, unused/shadowed variables, missing integrations, and missing inputs.

```bash
deepnote lint my-project.deepnote
```

**Checks:**

- **undefined-variable** - Variables used but never defined
- **circular-dependency** - Blocks with circular dependencies
- **unused-variable** - Variables defined but never used
- **shadowed-variable** - Variables that shadow previous definitions
- **parse-error** - Blocks that failed to parse
- **missing-integration** - SQL blocks using integrations that are not configured
- **missing-input** - Input blocks without default values

**Governance checks (`--governance`):**

| Code                   | Finding                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `sql-null-comparison`  | `= NULL` never matches a row — use `IS NULL`                              |
| `sql-tautology`        | A column compared to itself, making the join or filter a no-op            |
| `sql-string-boolean`   | A column compared to the string `'true'`/`'false'` instead of the keyword |
| `credential-hardcoded` | A credential written into a block                                         |

Credentials are reported by a truncated SHA-256 fingerprint, never by value, so the output is safe
to paste into a ticket and the same key is still recognizable across blocks. A block holding a
credential is labelled by its type and id rather than by its first line, for every rule reporting
it — not just the governance ones — because that first line is often the assignment itself.

The SQL checks read the query text only: no warehouse connection, no schema, and no Python
interpreter is required. Where the same characters mean different things to different warehouses,
the block's `sql_integration_id` decides. `flag = "true"` is a string comparison on MySQL, MariaDB
and BigQuery and so is flagged there; on the identifier-quoting dialects it names a column and is
left alone, as it is when the block declares no integration.

`--governance` covers what a single project can answer on its own. The checks that compare projects
against each other — duplicated metric definitions, personal data scattered across notebooks, writes
to third-party hosts, abandoned assets — need the whole synced workspace, and lint says so rather
than reporting an empty result.

**Options:**

| Option               | Description                                 | Default |
| -------------------- | ------------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm`              | text    |
| `--notebook <name>`  | Lint only a specific notebook               |         |
| `--python <path>`    | Path to Python interpreter                  |         |
| `--governance`       | Also run the governance checks listed above | off     |

**Exit codes:** `0` = no errors (warnings may be present), `1` = errors found, `2` = invalid usage.

**Examples:**

```bash
# Lint a .deepnote file
deepnote lint my-project.deepnote

# Output as JSON for CI/CD
deepnote lint my-project.deepnote -o json

# Use in CI pipeline
deepnote lint my-project.deepnote || exit 1

# Add the governance checks
deepnote lint my-project.deepnote --governance
```

### `audit [dir]`

Audit a synced workspace — the tree [`deepnote sync`](#sync-dir) writes. Answers the questions a
single project cannot: which integrations exist and who uses them, where data leaves to, and which
credentials are shared across projects.

```bash
deepnote sync ./workspace
deepnote audit ./workspace
```

Everything is computed locally from the `.deepnote` files: no warehouse connection, no Python
interpreter, and nothing leaves the machine.

**What it reports:**

- **Ingress** — every native integration, the projects that query it, and orphans: integrations
  declared but used by no block, whose credentials are still live.
- **Egress** — third-party hosts the code writes to, recovered from URLs in code blocks. Object
  store buckets count as their own destination.
- **Credentials** — credentials hardcoded in more than one project, by fingerprint, never by value.
- **Findings** — the workspace checks below, plus every `lint --governance` check run against each
  project.

| Code                             | Finding                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `ingress-integration-orphan`     | An integration is declared but no SQL block uses it                  |
| `ingress-integration-undeclared` | A SQL block runs against an integration the project does not declare |
| `egress-external`                | A code block writes to a host outside Deepnote and your integrations |
| `credential-shared`              | The same credential is hardcoded in more than one project            |

**Options:**

| Option               | Description                                     | Default |
| -------------------- | ----------------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm`                  | text    |
| `--project <name>`   | Audit a single project, by name or id           |         |
| `--issues`           | List every finding instead of a count per check | off     |

`-o json` includes a `flow` object — `nodes` for every integration, project and host, `edges` for
every connection — so the same report backs the terminal summary, a dashboard, or a diagram.

The report states its own limits on every run: egress is a lower bound (a host assembled from
variables at run time is invisible), integration usage counts SQL blocks in notebooks only, and
cross-project consensus checks are not run below roughly 100 projects.

**Exit codes:** `0` = the workspace was audited — findings never fail the command, because an audit
is an inventory rather than a gate; use `deepnote lint --governance` in CI. `1` = the workspace could
not be read, `2` = invalid usage.

**Examples:**

```bash
# Audit a synced workspace
deepnote audit ./workspace

# List every finding, not just counts per check
deepnote audit ./workspace --issues

# One project
deepnote audit ./workspace --project "Churn analysis"

# Full report, including the flow map
deepnote audit ./workspace -o json
```

### `stats <path>`

Show statistics about a `.deepnote` file including block counts, lines of code, and imported modules.

```bash
deepnote stats my-project.deepnote
```

**Options:**

| Option               | Description                        | Default |
| -------------------- | ---------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm`     | text    |
| `--notebook <name>`  | Show stats for a specific notebook |         |

**Examples:**

```bash
# Show project statistics
deepnote stats my-project.deepnote

# Output as JSON for scripting
deepnote stats my-project.deepnote -o json

# Show stats for a specific notebook
deepnote stats my-project.deepnote --notebook "Data Analysis"
```

### `analyze <path>`

Comprehensive project analysis combining quality scoring, structure analysis, dependency checks, and actionable suggestions.

```bash
deepnote analyze my-project.deepnote
```

**Options:**

| Option               | Description                             | Default |
| -------------------- | --------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json`, `toon`, or `llm` | text    |
| `--notebook <name>`  | Analyze only a specific notebook        |         |
| `--python <path>`    | Path to Python interpreter              |         |

**Examples:**

```bash
# Analyze a project
deepnote analyze my-project.deepnote

# Output for LLM consumption
deepnote analyze my-project.deepnote -o toon
```

### `dag <subcommand> <path>`

Analyze block dependencies and variable flow.

**Subcommands:**

| Subcommand   | Description                                     |
| ------------ | ----------------------------------------------- |
| `show`       | Show the dependency graph between blocks        |
| `vars`       | List variables defined and used by each block   |
| `downstream` | Show blocks that need re-run if a block changes |

**Options (shared):**

| Option               | Description                              | Default |
| -------------------- | ---------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json`, `dot`\*, or `llm` | text    |
| `--notebook <name>`  | Analyze only a specific notebook         |         |
| `--python <path>`    | Path to Python interpreter               |         |

\* `dot` format is only supported by `dag show`.

The `downstream` subcommand also requires `-b, --block <id>` to specify the block to analyze.

**Examples:**

```bash
# Show the dependency graph
deepnote dag show my-project.deepnote

# List variables for each block
deepnote dag vars my-project.deepnote

# Show what needs re-run if a block changes
deepnote dag downstream my-project.deepnote --block "Load Data"

# Generate Graphviz visualization
deepnote dag show my-project.deepnote -o dot | dot -Tpng -o deps.png
```

### `diff <path1> <path2>`

Compare two `.deepnote` files and show structural differences.

```bash
deepnote diff original.deepnote modified.deepnote
```

**Options:**

| Option               | Description                           | Default |
| -------------------- | ------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm`        | text    |
| `--content`          | Include content differences in output | `false` |

**Examples:**

```bash
# Compare two .deepnote files
deepnote diff original.deepnote modified.deepnote

# Compare with content differences
deepnote diff file1.deepnote file2.deepnote --content

# Output as JSON for scripting
deepnote diff file1.deepnote file2.deepnote -o json
```

### `convert <path>`

Convert between notebook formats.

```bash
deepnote convert notebook.ipynb
```

**Supported conversions:**

- **To Deepnote:** `.ipynb`, `.qmd`, `.py` → `.deepnote`
- **From Deepnote:** `.deepnote` → `.ipynb`, `.qmd`, `.py` (percent/marimo)

**Options:**

| Option                | Description                                                              | Default   |
| --------------------- | ------------------------------------------------------------------------ | --------- |
| `-o, --output <path>` | Output path (file or directory)                                          |           |
| `-n, --name <name>`   | Project name (for conversions to `.deepnote`)                            |           |
| `-f, --format <fmt>`  | Output format from `.deepnote`: `jupyter`, `percent`, `quarto`, `marimo` | `jupyter` |
| `--open`              | Open the converted `.deepnote` file in Deepnote Cloud                    | `false`   |

**Examples:**

```bash
# Convert Jupyter notebook to Deepnote
deepnote convert notebook.ipynb

# Convert and open in Deepnote Cloud
deepnote convert notebook.ipynb --open

# Convert a directory: one single-notebook .deepnote per notebook (into the dir, or use -o <dir>)
deepnote convert ./notebooks/

# Convert Deepnote to Jupyter
deepnote convert project.deepnote

# Convert Deepnote to Quarto
deepnote convert project.deepnote -f quarto

# Convert Deepnote to Marimo
deepnote convert project.deepnote -f marimo
```

### `split <path>`

Split a multi-notebook `.deepnote` file into separate single-notebook files.

The init notebook (if present) becomes its own standalone file, and each resulting main file keeps its `initNotebookId` so `deepnote run` resolves and runs the sibling init notebook as a prelude.

**Options:**

| Option               | Description                      | Default           |
| -------------------- | -------------------------------- | ----------------- |
| `-o, --output <dir>` | Output directory for split files | same dir as input |
| `--force`            | Overwrite existing output files  | `false`           |

**Examples:**

```bash
# Split into the same directory as the input
deepnote split my-project.deepnote

# Split into a specific output directory
deepnote split my-project.deepnote -o ./notebooks/

# Overwrite existing output files
deepnote split my-project.deepnote --force
```

### `open <path>`

Open a `.deepnote` file in Deepnote Cloud by uploading it and opening the URL in your default browser.

> **Note:** Files must be under 100 MB.

```bash
deepnote open my-project.deepnote
```

**Options:**

| Option               | Description                                   | Default        |
| -------------------- | --------------------------------------------- | -------------- |
| `-o, --output <fmt>` | Output format: `json` or `llm`                | text           |
| `--domain <domain>`  | Deepnote domain (for single-tenant instances) | `deepnote.com` |

**Examples:**

```bash
# Open a .deepnote file in Deepnote
deepnote open my-project.deepnote

# Open with JSON output (for scripting)
deepnote open my-project.deepnote -o json
```

### `publish <dir>`

Publish an app to an existing Deepnote project. An **app** is HTML, CSS, and JavaScript hosted by
Deepnote and run in the browser; it can be interactive and call the Deepnote API. To serve a Python
file already in the project as a Streamlit app, use [`streamlit publish`](#streamlit-publish-entrypoint).

The command uploads a local build directory and enables app sharing after every upload succeeds.

```bash
deepnote publish ./dist --project-id <uuid>
```

**Options:**

| Option                           | Description                                                           | Default                                     |
| -------------------------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| `--project-id <uuid>`            | Project to publish to (required)                                      |                                             |
| `--path <prefix>`                | Target directory at or below `_deepnote_static`                       | `_deepnote_static`                          |
| `--api-access enabled\|disabled` | Explicitly enable or disable API access for the published app         | unchanged                                   |
| `--prune`                        | Delete remote files below `--path` that are absent locally            | `false`                                     |
| `--sync-root <dir>`              | Sync workspace whose mirror to update                                 | search upwards from the published directory |
| `--no-sync-root`                 | Publish without looking for or updating a sync workspace              | `false`                                     |
| `--force`                        | Publish even when Deepnote holds changes the workspace has not synced | `false`                                     |
| `--token <token>`                | Deepnote API token                                                    | `DEEPNOTE_TOKEN`                            |
| `--url <url>`                    | Deepnote API base URL                                                 | `https://api.deepnote.com`                  |

Use `--api-access enabled` only when an app needs to read notebook inputs or start runs through
the Deepnote API.

Every published file is readable by anyone who can view the site, so the command refuses to publish
a directory that contains a `.env` or `.env.*` file at any depth (exit code `2`, nothing uploaded).
Publish a clean build output directory, not a project root.

#### Working with `deepnote sync`

When publishing from a synced workspace, the command updates its `.files/` mirror and
`.deepnote-sync.json`. If a file to be replaced or pruned has changed remotely since its recorded
baseline, publish stops: pull and reconcile the changes, or use `--force` to overwrite them.
Use `--sync-root` to select a workspace or `--no-sync-root` for a CI deployment.

`publish --prune` deletes **remote** files absent from the build. `sync --prune` deletes **local**
files absent from Deepnote.

**Examples:**

```bash
# Publish an app with viewer API access
deepnote publish ./dist --project-id <uuid> --api-access enabled

# Remove files left behind by an older build
deepnote publish ./dist --project-id <uuid> --prune

# Publish a versioned subdirectory
deepnote publish ./dist --project-id <uuid> --path _deepnote_static/v2

# CI deploy: never touch a sync workspace
deepnote publish ./dist --project-id <uuid> --no-sync-root
```

### `static-site access`

Change access to an already-published app without uploading or deleting files. At least one
of `--sharing` and `--api-access` is required.

```bash
# Stop serving the app; its files remain stored
deepnote static-site access --project-id <uuid> --sharing disabled

# Serve the stored files again and allow viewer-scoped Deepnote API calls
deepnote static-site access --project-id <uuid> --sharing enabled --api-access enabled

# Revoke viewer API access without changing the current sharing setting
deepnote static-site access --project-id <uuid> --api-access disabled
```

Disabling sharing also disables viewer API access. Re-enabling sharing later serves the same stored
files at the canonical URL. Use `--token` or `DEEPNOTE_TOKEN` for authentication and `--url` to
select a non-default API origin.

### `streamlit publish <entrypoint>`

Serve a Python file already in the project's Files as a **Streamlit app**, a Python UI that runs on
the project's hardware. The entrypoint is a project-relative path; the command registers it and does
not upload it.

```bash
deepnote streamlit publish apps/dashboard.py --project-id <uuid>
```

**Options:**

| Option                | Description                               | Default                    |
| --------------------- | ----------------------------------------- | -------------------------- |
| `--project-id <uuid>` | Project to publish to (required)          |                            |
| `--no-wait`           | Exit without waiting for the app to start | `false`                    |
| `--token <token>`     | Deepnote API token                        | `DEEPNOTE_TOKEN`           |
| `--url <url>`         | Deepnote API base URL                     | `https://api.deepnote.com` |

Upload the entrypoint and its dependencies into the project's Files in Deepnote before publishing.
If a notebook push is already pending in a sync workspace, `deepnote sync --all-files` can include
the working files. For a `.py`-only edit, upload in Deepnote; sync does not push that edit alone.

Creating a Streamlit app restarts the project machine and interrupts active work. The command
prints the app URL and waits up to 10 minutes for it to start. An existing Streamlit app keeps its
ID and URL and does not restart the machine. The command waits for existing Streamlit apps too.
Use `--no-wait` to return after either creation or lookup without checking readiness.

API calls from a hosted Streamlit app work only when the project owner has enabled Streamlit app
API access, and only for signed-in viewers with direct access to the project.

Deleting the entrypoint can remove its app registration; some apps created in the UI retain it.
Sync replaces changed files by deleting and uploading them, so publish again after syncing an edited
entrypoint and use the returned URL, which may change. See the
[publishing guide](../../docs/deepnote-cli-publish.md) for access requirements and failure handling.

**Examples:**

```bash
# Serve a file already in the project as a Streamlit app and wait for it to start
deepnote streamlit publish apps/dashboard.py --project-id <uuid>

# Publish without waiting for the app to start
deepnote streamlit publish apps/dashboard.py --project-id <uuid> --no-wait
```

### `schedule <path>`

Create or update a recurring notebook run in Deepnote Cloud. This does not run the notebook
immediately. If the local project is missing in Deepnote, the CLI creates it without opening a browser first.

```bash
deepnote schedule report.deepnote --daily --at 09:00
```

Choose exactly one frequency:

| Option                  | Description                                     | Default                    |
| ----------------------- | ----------------------------------------------- | -------------------------- |
| `--hourly`              | Run every hour                                  | the creation minute        |
| `--daily`               | Run every day                                   |                            |
| `--weekly <day>`        | Run weekly on Monday-Sunday                     |                            |
| `--monthly <day>`       | Run monthly on day 1-31                         |                            |
| `--cron <expression>`   | Use a custom five-field cron expression         |                            |
| `--at <HH:mm>`          | Time for daily/weekly/monthly; minute if hourly | the creation time          |
| `--timezone <timezone>` | IANA timezone                                   | local system timezone      |
| `--notebook <name>`     | Target a notebook in a multi-notebook file      | single notebook            |
| `--token <token>`       | Deepnote API token                              | `DEEPNOTE_TOKEN` or `.env` |
| `--url <url>`           | Deepnote API base URL                           | `https://api.deepnote.com` |
| `--no-create`           | Fail rather than create a missing project       | `false`                    |
| `--open`                | Open the scheduled notebook after configuration | `false`                    |
| `-o, --output json`     | Print machine-readable JSON                     | text                       |

Deepnote supports one scheduled notebook per project. Re-running this command updates that project
schedule, including when a different notebook is selected. Scheduling availability depends on the
workspace plan.

Without `--at`, a schedule fires at the time it was created — hour and minute for daily, weekly and
monthly, the minute alone for `--hourly`. Deepnote's scheduling UI defaults new schedules the same
way, so runs spread out instead of piling onto the same execution spike. Pass `--at 09:00` (or
`--at :15` for `--hourly`) to pin a specific time.

**Examples:**

```bash
# Every weekday morning in London
deepnote schedule report.deepnote --cron "0 8 * * 1-5" --timezone Europe/London

# Every Monday, selecting one notebook from the project
deepnote schedule project.deepnote --notebook "Weekly review" --weekly Monday --at 08:30

# Configure it and open the cloud notebook
deepnote schedule report.deepnote --daily --open

# Machine-readable output
deepnote schedule report.deepnote --hourly -o json
```

### `sync [dir]`

Mirror Deepnote projects into a local directory: every project in your workspace becomes a directory
`<folder path>/<project name>/` holding one `.deepnote` file per notebook, mirroring the workspace
folder tree.

```bash
deepnote sync workspace
```

Sync state lives in `.deepnote-sync.json` in the synced directory. Projects are tracked by id
(names are not unique in Deepnote), so cloud renames become local directory moves, and name
collisions are disambiguated deterministically with a short id suffix. A project export is a ZIP of
one deterministic document per notebook, so unchanged projects are detected by a content-hash
comparison (over the documents, not the archive) and skipped.
When the API reports only a visible suffix of a folder path, sync places it under
`.deepnote-incomplete/<folder-id>/` instead of treating that suffix as the workspace-root hierarchy.

Both directions work. Pull writes the exported documents down. Push is the **exact inverse** — a
project edited only locally is re-uploaded as the same ZIP of documents to the project import
endpoint, with `baseModifiedAt` + `baseContentHash` so a concurrent cloud edit is rejected (409) and
resolved as override-or-skip rather than a silent overwrite. A project edited both locally and in the
cloud is a conflict, resolved the same way. Project name and integration attachment edits are also
applied from the documents; every document in a multi-notebook project must carry the same values.
`--all-files` uploads changed working-directory files on push. File replacements are recorded before
the cloud copy is deleted, so an interrupted upload is retried on the next `--all-files` sync.
Working-directory files larger than 100 MiB are rejected because these transfers are buffered in
memory; use another transfer method for larger data files.

Sync is not the only writer of a project's files — [`deepnote publish`](#publish-dir) deploys into
`_deepnote_static/` and the Deepnote app can write anything — so each file is checked against the
cloud inventory before it is uploaded. A file whose cloud copy changed, or was deleted, since the
manifest last recorded it goes through the same `--on-conflict` override-or-skip choice as a diverged
notebook; skipped files are reported as `N file(s) kept from Deepnote`. Files synced before
`updatedAt` was recorded have no baseline to compare and are still overwritten; they become
verifiable after the next pull.

If a push changes `project.name`, the current run finishes in the existing local directory. The next
sync sees the new cloud name and moves the tracked directory through the normal cloud-rename path.
Renaming the local directory itself does not rename the cloud project. The full import contract is in
`packages/cloud/docs/project-import-contract.md`.

Sync never creates or deletes cloud projects. Pulls reconcile a tracked project's `.deepnote` files,
removing local notebook files absent from the cloud export. Deleting directories for projects missing
from the cloud or stale working-directory files requires `--prune`. Sync does not run git — commit and
push yourself. Even with `--prune`, a stale manifest entry cannot delete a directory whose path is now
used by a current cloud project. Sync also refuses to prune when none of the tracked project IDs match
the listed workspace; verify the API token and `--url` before retrying.

**Options:**

| Option                       | Description                                                             | Default      |
| ---------------------------- | ----------------------------------------------------------------------- | ------------ |
| `--url <url>`                | API base URL                                                            | Deepnote API |
| `--token <token>`            | Bearer token (or use `DEEPNOTE_TOKEN` env var)                          |              |
| `--all-files`                | Also sync working-directory files (download on pull, upload on push)    | off          |
| `--on-conflict <mode>`       | Conflict handling: `ask`, `skip`, or `override`                         | `ask`        |
| `--delete-missing-notebooks` | On push, delete cloud notebooks removed from the local project          | off          |
| `--prune`                    | Delete local files for projects/files that no longer exist in the cloud | off          |
| `--dry-run`                  | Show what would be synced without writing anything                      | off          |
| `--concurrency <n>`          | How many projects to sync at once                                       | `8`          |
| `-o, --output <fmt>`         | Output format: `json` or `llm`                                          | text         |

**Examples:**

```bash
# Mirror the whole workspace into ./workspace
deepnote sync workspace

# Also download working-directory files (data, requirements.txt, …)
deepnote sync workspace --all-files

# Non-interactive: skip anything conflicting (good for cron/CI)
deepnote sync workspace --on-conflict skip

# Preview without writing
deepnote sync workspace --dry-run
```

### `validate <path>`

Validate a `.deepnote` file against the schema.

```bash
deepnote validate my-project.deepnote
```

**Options:**

| Option               | Description                    | Default |
| -------------------- | ------------------------------ | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm` | text    |

**Examples:**

```bash
# Validate a file
deepnote validate my-project.deepnote

# JSON output for CI/CD pipelines
deepnote validate my-project.deepnote --output json
```

### `integrations pull`

Pull database integrations from the Deepnote API and merge with a local integrations file.

```bash
deepnote integrations pull
```

**Options:**

| Option              | Description                                    | Default                    |
| ------------------- | ---------------------------------------------- | -------------------------- |
| `--url <url>`       | API base URL                                   | `https://api.deepnote.com` |
| `--token <token>`   | Bearer token (or use `DEEPNOTE_TOKEN` env var) |                            |
| `--file <path>`     | Path to integrations file                      | `.deepnote.env.yaml`       |
| `--env-file <path>` | Path to `.env` file for storing secrets        | `.env`                     |

If the local integrations file contains invalid YAML (for example, unresolved merge conflict markers), the command fails with exit code 2 and does not modify any files — fix or delete the file manually, then re-run.

**Examples:**

```bash
# Pull integrations from Deepnote API
deepnote integrations pull

# Pull with a specific token
deepnote integrations pull --token <token>

# Pull to a custom file path
deepnote integrations pull --file my-integrations.yaml
```

### `integrations add`

Add a new database integration interactively. Prompts for the integration type, a name, and the type-specific connection fields. Secret values are written to the `.env` file and referenced from the YAML as `env:` placeholders.

```bash
deepnote integrations add
```

**Options:**

| Option              | Description                             | Default              |
| ------------------- | --------------------------------------- | -------------------- |
| `--file <path>`     | Path to integrations file               | `.deepnote.env.yaml` |
| `--env-file <path>` | Path to `.env` file for storing secrets | `.env`               |

### `integrations edit [id]`

Edit an existing database integration interactively. Without `[id]`, shows a picker of the integrations found in the file.

```bash
deepnote integrations edit
deepnote integrations edit <integration-id>
```

**Options:**

| Option              | Description                             | Default              |
| ------------------- | --------------------------------------- | -------------------- |
| `--file <path>`     | Path to integrations file               | `.deepnote.env.yaml` |
| `--env-file <path>` | Path to `.env` file for storing secrets | `.env`               |

Like `integrations pull`, both commands fail with exit code 2 and leave all files untouched if the integrations file contains invalid YAML.

### `completion <shell>`

Generate shell completion scripts for tab completion.

**Supported shells:** `bash`, `zsh`, `fish`

**Installation:**

```bash
# Bash (add to ~/.bashrc or ~/.bash_profile)
deepnote completion bash >> ~/.bashrc
source ~/.bashrc

# Zsh (add to ~/.zshrc)
deepnote completion zsh >> ~/.zshrc
source ~/.zshrc

# Fish (save to completions directory)
deepnote completion fish > ~/.config/fish/completions/deepnote.fish
```

### `install-skills`

Install the Deepnote skill for AI coding assistants (Claude Code, Cursor, Windsurf, etc.). The skill gives your AI assistant knowledge of the `.deepnote` file format, CLI commands, and block types.

```bash
deepnote install-skills
```

**Options:**

| Option                | Description                                         |
| --------------------- | --------------------------------------------------- |
| `-g, --global`        | Install to your home directory instead of project   |
| `-a, --agent <agent>` | Target a specific agent (e.g. `cursor`, `windsurf`) |
| `--dry-run`           | Preview what would be installed without writing     |

**Supported agents:** Claude Code, Cursor, Windsurf, GitHub Copilot, Cline, Roo Code, Augment, Continue, Antigravity, Trae, Goose, Junie, Kilo Code, Kiro, Codex, Gemini CLI, Amp, Kimi Code CLI, OpenCode.

**Examples:**

```bash
# Install for all detected agents in the current project
deepnote install-skills

# Install globally (available across all projects)
deepnote install-skills --global

# Install for a specific agent
deepnote install-skills --agent cursor
deepnote install-skills --agent "github copilot"
deepnote install-skills --agent windsurf

# Preview without writing files
deepnote install-skills --dry-run
```

## Global Options

These options work with all commands:

| Option          | Description                                        |
| --------------- | -------------------------------------------------- |
| `-h, --help`    | Display help information                           |
| `-v, --version` | Display the CLI version                            |
| `--no-color`    | Disable colored output                             |
| `--debug`       | Show debug information for troubleshooting         |
| `-q, --quiet`   | Suppress non-essential output (errors still shown) |

## Environment Variables

| Variable         | Description                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `DEEPNOTE_TOKEN` | API token for commands that talk to Deepnote Cloud (`sync`, `publish`, `schedule`, `run --cloud`, ...) |
| `NO_COLOR`       | Set to any value to disable colored output                                                             |
| `FORCE_COLOR`    | Set to `1` to force colors, `0` to disable                                                             |

`DEEPNOTE_TOKEN` can also live in a `.env` file. Which one depends on the command:

- `run`: the run's working directory (`--cwd`, otherwise the notebook's directory). With `--cloud`: next to
  the local `.deepnote` file, or the current directory when only `--notebook-id` is given
- `schedule`: next to the `.deepnote` file
- `sync`: the sync root
- `publish`, `streamlit publish` and `static-site access`: the current directory
- `integrations pull`: the file given by `--env-file` (default `.env`)

`--token` wins over everything, and a value already set in the shell wins over `.env`.

Create an API key in Deepnote under **Settings & members > Security > API keys** (see the [Deepnote API docs](https://deepnote.com/docs/deepnote-api)).

The CLI follows the [NO_COLOR](https://no-color.org/) and [FORCE_COLOR](https://force-color.org/) standards.

## Exit Codes

The CLI uses standard exit codes for scripting:

| Code | Name          | Description                                   |
| ---- | ------------- | --------------------------------------------- |
| `0`  | Success       | Command completed successfully                |
| `1`  | Error         | General error (runtime failures)              |
| `2`  | Invalid Usage | Invalid arguments, file not found, wrong type |

**Example usage in scripts:**

```bash
#!/bin/bash
if deepnote inspect project.deepnote --output json > /dev/null 2>&1; then
    echo "Valid .deepnote file"
else
    exit_code=$?
    if [ $exit_code -eq 2 ]; then
        echo "Invalid file or arguments"
    else
        echo "Unexpected error"
    fi
fi
```

## Output Formats

The CLI supports output formats via the `-o, --output` option:

| Format | Description                                                                             |
| ------ | --------------------------------------------------------------------------------------- |
| `json` | Standard JSON format for scripting and CI/CD pipelines                                  |
| `toon` | [TOON format](https://toonformat.dev/) - LLM-optimized, 30-60% fewer tokens             |
| `llm`  | Alias to the best LLM format for each command (`toon` when available, otherwise `json`) |

## JSON Output Schema

### `inspect --output json`

```typescript
interface InspectOutput {
  success: true;
  path: string;
  project: {
    name: string;
    id: string;
  };
  version: string;
  metadata: {
    createdAt: string;
    modifiedAt: string | null;
    exportedAt: string | null;
  };
  statistics: {
    notebookCount: number;
    totalBlocks: number;
  };
  notebooks: Array<{
    name: string;
    blockCount: number;
    isModule: boolean;
  }>;
}

// On error:
interface InspectError {
  success: false;
  error: string;
}
```

### `run --output json`

```typescript
interface RunOutput {
  success: boolean;
  path: string;
  executedBlocks: number;
  totalBlocks: number;
  failedBlocks: number;
  totalDurationMs: number;
  blocks: Array<{
    id: string;
    type: string;
    label: string;
    success: boolean;
    durationMs: number;
    outputs: Array<{
      output_type: "stream" | "execute_result" | "display_data" | "error";
      // For stream outputs:
      name?: "stdout" | "stderr";
      text?: string;
      // For execute_result/display_data:
      data?: Record<string, unknown>;
      // For error outputs:
      ename?: string;
      evalue?: string;
      traceback?: string[];
    }>;
    error?: string;
  }>;
}

// On error before execution starts:
interface RunError {
  success: false;
  error: string;
}
```

### `validate --output json`

```typescript
// When validation runs (file found and readable):
interface ValidationResult {
  success: true;
  path: string;
  valid: boolean;
  issues: Array<{
    path: string; // JSON path to the invalid field (e.g., "notebooks.0.blocks.1")
    message: string;
    code: string; // Zod error code (e.g., "invalid_type", "unrecognized_keys")
  }>;
}

// On error (file not found, resolution error, or runtime failure):
interface ValidationError {
  success: false;
  error: string;
}
```

The `success` field indicates whether the command completed:

- `success: true` - validation ran, check `valid` for the result
- `success: false` - operational error (file not found, etc.)

## Programmatic Usage

The CLI can also be used programmatically:

```typescript
import { createProgram, run, ExitCode } from "@deepnote/cli";

// Run with custom arguments
run(["node", "deepnote", "inspect", "project.deepnote"]);

// Or create and configure the program manually
const program = createProgram();
program.parse([
  "node",
  "deepnote",
  "inspect",
  "project.deepnote",
  "--output",
  "json",
]);
```

## Error Messages

The CLI provides helpful error messages with suggestions:

```bash
$ deepnote inspect missing-file.deepnote
# Error: File not found: /path/to/missing-file.deepnote
#
# Did you mean?
#   - my-project.deepnote
#   - another-project.deepnote

$ deepnote inspect notebook.ipynb
# Error: Unsupported file type: .ipynb
#
# Jupyter notebooks (.ipynb) are not directly supported.
# Use the @deepnote/convert package to convert to .deepnote format.
```

## Related Packages

- [`@deepnote/blocks`](../blocks) - Core package for working with Deepnote blocks
- [`@deepnote/cloud`](../cloud) - Client for the Deepnote Cloud runs API (used by `run --cloud`)
- [`@deepnote/convert`](../convert) - Convert between Jupyter and Deepnote formats
- [`@deepnote/runtime-core`](../runtime-core) - Runtime engine for executing notebooks

## License

Apache-2.0
