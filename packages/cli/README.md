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

# Publish a static website to an existing Deepnote project
deepnote publish ./dist --project-id <uuid>

# Stop serving it later without deleting its files
deepnote static-site access --project-id <uuid> --sharing disabled
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

| Option                  | Description                                                               | Default                    |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------- |
| `--python <path>`       | Path to Python interpreter or virtual environment                         | auto-detected              |
| `--cwd <path>`          | Working directory for execution                                           | file directory             |
| `--notebook <name>`     | Run only the specified notebook                                           | all notebooks              |
| `--block <id>`          | Run only the specified block                                              | all blocks                 |
| `-i, --input <key=val>` | Set input variable value (can be repeated)                                |                            |
| `--list-inputs`         | List input variables without running                                      | `false`                    |
| `--prompt <text>`       | Run an LLM agent block with the given prompt (requires `OPENAI_API_KEY`)  |                            |
| `-o, --output <fmt>`    | Output format: `json`, `toon`, or `llm`                                   | text                       |
| `--dry-run`             | Show execution plan without running                                       | `false`                    |
| `--top`                 | Display resource usage (CPU/memory) during execution                      | `false`                    |
| `--profile`             | Show per-block timing and memory summary                                  | `false`                    |
| `--open`                | Open project in Deepnote Cloud after successful execution                 | `false`                    |
| `--context`             | Include analysis context in output (requires `-o json/toon/llm`)          | `false`                    |
| `--cloud`               | Run in Deepnote Cloud, then download the snapshot locally                 | `false`                    |
| `--notebook-id <uuid>`  | Cloud notebook id to run (with `--cloud`)                                 |                            |
| `--out <path>`          | Write the downloaded cloud snapshot to this exact path                    |                            |
| `--storage-mode <mode>` | Project-storage access for a detached cloud run: `read-write`, `readonly` | `read-write`               |
| `--timeout <seconds>`   | Max seconds to wait for a cloud run (with `--cloud`)                      | `600`                      |
| `--push`                | Push the local `.deepnote` blocks to the Deepnote notebook before running | `false`                    |
| `--yes`                 | Skip the `--push` confirmation prompt                                     | `false`                    |
| `--url <url>`           | API base URL                                                              | `https://api.deepnote.com` |
| `--token <token>`       | Bearer token (or `DEEPNOTE_TOKEN` env var)                                |                            |

**Examples:**

```bash
# Run a .deepnote file (executes every notebook it contains)
deepnote run my-project.deepnote

# Run a Jupyter notebook directly (auto-converted)
deepnote run notebook.ipynb

# Run with a specific Python virtual environment
deepnote run my-project.deepnote --python path/to/venv

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

#### Agent Block (`--prompt` and agent blocks)

The `--prompt` flag appends an agent block to the notebook (or creates one from scratch) and runs it. The agent can read prior block outputs, execute Python code, and add new blocks to the notebook autonomously.

**Requirements:**

- `OPENAI_API_KEY` environment variable must be set (works with any OpenAI-compatible API)
- Optionally set `OPENAI_BASE_URL` for non-OpenAI providers (Ollama, LiteLLM, etc.)
- Model selection precedence:
  - If the agent block sets `deepnote_agent_model` to a specific model, that model is used.
  - If `deepnote_agent_model` is `"auto"` (or omitted), `OPENAI_MODEL` is used when set.
  - If neither a block-specific model nor `OPENAI_MODEL` is set, the runtime falls back to `gpt-5`.
  - `OPENAI_BASE_URL` only changes the provider endpoint; it does not change the precedence above or the final `gpt-5` fallback.

When database integrations are configured, the agent is automatically made aware of them and can query them using `deepnote-toolkit`.

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

**Options:**

| Option               | Description                    | Default |
| -------------------- | ------------------------------ | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm` | text    |
| `--notebook <name>`  | Lint only a specific notebook  |         |
| `--python <path>`    | Path to Python interpreter     |         |

**Exit codes:** `0` = no errors (warnings may be present), `1` = errors found, `2` = invalid usage.

**Examples:**

```bash
# Lint a .deepnote file
deepnote lint my-project.deepnote

# Output as JSON for CI/CD
deepnote lint my-project.deepnote -o json

# Use in CI pipeline
deepnote lint my-project.deepnote || exit 1
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

Publish a local static website to an existing Deepnote project. Matching remote files are replaced,
then static website sharing is enabled only after every upload succeeds. By default, existing remote
files that are absent locally and the project's API-access setting are both left unchanged.

```bash
deepnote publish ./dist --project-id <uuid>
```

**Options:**

| Option                           | Description                                                           | Default                     |
| -------------------------------- | --------------------------------------------------------------------- | --------------------------- |
| `--project-id <uuid>`            | Project to publish to (required)                                      |                             |
| `--path <prefix>`                | Target directory at or below `_deepnote_static`                       | `_deepnote_static`          |
| `--api-access enabled\|disabled` | Explicitly enable or disable API access for the published website     | unchanged                   |
| `--prune`                        | Delete remote files below `--path` that are absent locally            | `false`                     |
| `--sync-root <dir>`              | Sync workspace whose mirror to update                                 | search upwards from `<dir>` |
| `--no-sync-root`                 | Publish without looking for or updating a sync workspace              | `false`                     |
| `--force`                        | Publish even when Deepnote holds changes the workspace has not synced | `false`                     |
| `--token <token>`                | Deepnote API token                                                    | `DEEPNOTE_TOKEN`            |
| `--url <url>`                    | Deepnote API base URL                                                 | `https://api.deepnote.com`  |

The command prints the canonical website URL returned by the server. Use `--api-access enabled`
only when the website needs to load notebooks or start runs through the Deepnote API.

#### Working with `deepnote sync`

`_deepnote_static/` lives in the same project file store that [`deepnote sync --all-files`](#sync-dir)
mirrors, so both commands write it. They share one baseline rather than dividing the namespace:

- When the published directory sits inside a synced workspace, publish also writes the files into
  that project's `.files/` mirror and records them in `.deepnote-sync.json` — exactly as a sync
  download would. Afterwards the manifest, the mirror, and Deepnote agree, so sync sees the deploy
  as already in step instead of re-downloading the whole site on its next run.
- If files below `--path` changed in Deepnote since the workspace last recorded them (an
  `--all-files` sync, or an earlier publish on a server that echoes upload timestamps), publish
  stops instead of destroying content the mirror does not hold. Pull first, or pass `--force`. Files
  without such a baseline only get a warning — sync with `--all-files` once to make the check
  effective.
- `--prune` also drops the pruned files from the mirror, so a later push cannot resurrect them.
- `--no-sync-root` skips all of this — the right choice for a CI deploy. Sync stays safe either way:
  it checks every file against Deepnote before pushing and asks before overwriting a newer copy.

Note the two `--prune` flags point in opposite directions: `publish --prune` deletes **remote** files
absent from the local build, while `sync --prune` deletes **local** files absent from the cloud.

**Examples:**

```bash
# Publish an app that needs a static-app viewer token
deepnote publish ./dist --project-id <uuid> --api-access enabled

# Remove files left behind by an older build
deepnote publish ./dist --project-id <uuid> --prune

# Publish a versioned subdirectory
deepnote publish ./dist --project-id <uuid> --path _deepnote_static/v2

# CI deploy: never touch a sync workspace
deepnote publish ./dist --project-id <uuid> --no-sync-root
```

### `static-site access`

Change access to an already-published static site without uploading or deleting files. At least one
of `--sharing` and `--api-access` is required.

```bash
# Stop serving the site; its files remain stored
deepnote static-site access --project-id <uuid> --sharing disabled

# Serve the stored files again and allow viewer-scoped Deepnote API calls
deepnote static-site access --project-id <uuid> --sharing enabled --api-access enabled

# Revoke viewer API access without changing the current sharing setting
deepnote static-site access --project-id <uuid> --api-access disabled
```

Disabling sharing also disables viewer API access. Re-enabling sharing later serves the same stored
files at the canonical URL. Use `--token` or `DEEPNOTE_TOKEN` for authentication and `--url` to
select a non-default API origin.

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

| Variable      | Description                                |
| ------------- | ------------------------------------------ |
| `NO_COLOR`    | Set to any value to disable colored output |
| `FORCE_COLOR` | Set to `1` to force colors, `0` to disable |

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
