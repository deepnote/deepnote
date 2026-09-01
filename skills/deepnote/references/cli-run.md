# CLI: Run Command

Install: `npm install -g @deepnote/cli`

## `deepnote run [path]`

Execute notebooks (.deepnote, .ipynb, .py, .qmd).

| Option                    | Description                                                       |
| ------------------------- | ----------------------------------------------------------------- |
| `--python <path>`         | Path to Python (executable, bin directory, or venv root)          |
| `--cwd <path>`            | Working directory for execution                                   |
| `--notebook <name>`       | Run only the specified notebook                                   |
| `--block <id>`            | Run only the specified block                                      |
| `-i, --input <key=value>` | Set input variable value (repeatable)                             |
| `--list-inputs`           | List all input variables without running                          |
| `--prompt <text>`         | Run an agent block with the given prompt                          |
| `-o, --output <format>`   | Output format: `json`, `toon`, `llm`                              |
| `--dry-run`               | Show what would be executed without running                       |
| `--top`                   | Display resource usage (CPU, memory) during execution             |
| `--profile`               | Show per-block timing and memory usage                            |
| `--open`                  | Open the project in Deepnote Cloud after execution                |
| `--context`               | Include analysis context in output                                |
| `--cloud`                 | Run in Deepnote Cloud, then download the snapshot locally         |
| `--notebook-id <uuid>`    | Cloud notebook id to run (with `--cloud`)                         |
| `--out <path>`            | Write the downloaded cloud snapshot to this exact path            |
| `--storage-mode <mode>`   | Detached-run project storage: `read-write` or `readonly`          |
| `--timeout <seconds>`     | Max seconds to wait for a cloud run (with `--cloud`, default 600) |
| `--url <url>`             | API base URL (default `https://api.deepnote.com`)                 |
| `--token <token>`         | Bearer token (or `DEEPNOTE_TOKEN` env var)                        |

**Examples:**

```bash
# Run a Jupyter notebook (auto-converts)
deepnote run notebook.ipynb

# Run with a specific Python venv
deepnote run my-project.deepnote --python path/to/venv

# Run a specific notebook within a project
deepnote run my-project.deepnote --notebook "Data Analysis"

# Run a specific block
deepnote run my-project.deepnote --block abc123

# Set input values
deepnote run my-project.deepnote --input name="Alice" --input count=42

# Set a checkbox and a multi-select input
deepnote run my-project.deepnote --input enabled=true --input regions='["US","EU"]'

# Preview without running
deepnote run my-project.deepnote --dry-run

# Profile execution
deepnote run my-project.deepnote --profile

# Run and open in Deepnote Cloud
deepnote run notebook.ipynb --open

# Run an agent block with a prompt (appends to existing file)
OPENAI_API_KEY=sk-... deepnote run my-project.deepnote --prompt "Analyze the data"

# Run an agent block standalone (no file needed)
OPENAI_API_KEY=sk-... deepnote run --prompt "Write a hello world script"
```

Use plain strings for text, date, file, slider, and single-select inputs; use `true` or `false` for checkboxes; and use
JSON arrays of strings for multi-select inputs and absolute date ranges. Unknown input names and invalid values are
rejected before execution.

A local run whose executing blocks include a SQL block against a `big-query` + `google-oauth`
integration fails before the kernel starts unless `deepnote integrations auth <id>` has already been
run — no partial execution. `--dry-run` only checks that a credential is stored and its client
fingerprint matches; it never contacts Google or writes to the token store. `--cloud` is unaffected,
since it authenticates BigQuery server-side. The MCP `deepnote_run` tool and `packages/local-runner`
used outside the CLI inject no integration credentials at all, federated or otherwise, so this gate
exists only in the CLI's `deepnote run`.

## Run in Deepnote Cloud (`--cloud`)

By default `run` executes locally against a Python kernel. With `--cloud` it instead triggers a
run of an **existing** notebook in your Deepnote workspace via the public API
(`POST /v2/runs`), polls it to completion (`GET /v2/runs/{runId}`), and downloads the resulting
snapshot into the local `snapshots/` directory — the same format `deepnote diff` reads.

Requires a token: `--token <token>` or the `DEEPNOTE_TOKEN` env var
(get one at https://deepnote.com/workspace/settings/api-tokens).

The notebook to run is resolved in this order:

1. `--notebook-id <uuid>` — run a remote notebook directly (no local file needed).
2. A local `.deepnote` file with `--notebook "<name>"` — the named notebook's id.
3. A single-notebook `.deepnote` file — its notebook id.

The notebook must already exist in Deepnote; `--cloud` does not create it, and non-`.deepnote`
inputs are rejected. Snapshots are written as a timestamped file plus a `latest` copy, unless
`--out <path>` is given (single file). `--input`, `--block`, `--notebook`, `--url`, `--token`,
`--storage-mode`, `--push`, and `--yes` are honored; local-only flags (`--python`, `--cwd`,
`--top`, `--profile`, `--open`, `--prompt`, `--list-inputs`, `--context`) are not. `--dry-run` is
rejected with `--cloud` unless `--push` is set, where it previews the push plan instead.

Full-notebook cloud runs are detached, so Deepnote executes a copy without changing outputs in the
live editor. This does not isolate anything the notebook accesses: project files remain shared and
writable by default, and databases, integrations, external APIs, and other systems remain live.
Use `--storage-mode readonly` to make persistent project storage read-only for that detached run;
reads and temporary files still work. Block-scoped cloud runs are different: the API runs them in
live mode, they update live-editor outputs, and they cannot be combined with `--storage-mode`.

`--push` sends the local file's blocks to the Deepnote notebook before the run, so the cloud
executes what is on disk rather than what was last saved in Deepnote. The sync is destructive — a
cloud block the file does not have is deleted, and a block whose type or metadata changed is
recreated under a new id (a `--block` selection is remapped to the new id automatically). The CLI
prints the plan and asks for confirmation: `--yes` skips the question and is required when output
is piped or machine-readable; a declined confirmation exits `0` without running. `--push --dry-run`
prints the plan and exits without sending or running anything; with `-o json`/`-o toon` it emits
`{ previewed, plan: { changes, moves, warnings, isEmpty } }` instead of a run result.

`--input` follows the same rules as a local run: each value is typed by the input block it names,
and unknown names or invalid values are rejected before the run is triggered. Typing a value
requires the notebook's blocks, so `--input` needs the local `.deepnote` file — pass the file
rather than only `--notebook-id`.

**Machine output** (`-o json` / `-o toon`; `-o llm` resolves to `toon`):
`{ success, runId, status, artifactStatus, snapshotPath?, timestampedSnapshotPath?, artifactError?, error? }`.
`success` is the overall command outcome: the run succeeded **and** its snapshot was delivered.
`status` reports execution alone; `artifactStatus` reports artifact delivery: `saved`,
`synthesized` (no API artifact; an output-free snapshot was written from the local source),
`not_produced`, or `unavailable`. A completed run with status `error`/`internal_error`/`stopped`
exits `1` but still reports the `runId`, `status`, and any `snapshotPath`.

After terminal status, the CLI polls briefly for snapshot attachment; empty snapshot content is
treated as no snapshot. A successful empty or markdown-only notebook can legitimately produce
none: with a local file, the CLI synthesizes a valid output-free snapshot from that source, marks
it `artifactStatus: synthesized`, notes the synthesis in human output, and exits `0`. Any other
successful run that produces no snapshot — including with only `--notebook-id` — exits `1` with
`artifactStatus: not_produced` and an `artifactError`. An advertised snapshot that cannot be
downloaded or saved reports `artifactStatus: unavailable`, includes `artifactError`, and exits `1`.

```bash
# Run an existing cloud notebook by id and download its snapshot
DEEPNOTE_TOKEN=... deepnote run --cloud --notebook-id 0f1e2d3c-4b5a-6789-abcd-ef0123456789

# Run a .deepnote (notebook id read from the file) in the cloud, with inputs
DEEPNOTE_TOKEN=... deepnote run my-project.deepnote --cloud --input name="Alice"

# Run the whole notebook without allowing writes to persistent project storage
DEEPNOTE_TOKEN=... deepnote run my-project.deepnote --cloud --storage-mode readonly

# Push local edits to the notebook first, then run what is on disk (asks before changing it)
DEEPNOTE_TOKEN=... deepnote run my-project.deepnote --cloud --push

# Machine-readable result
DEEPNOTE_TOKEN=... deepnote run my-project.deepnote --cloud -o json
```

**Environment variables for `--prompt` / agent blocks:**

| Variable          | Required | Description                                                     |
| ----------------- | -------- | --------------------------------------------------------------- |
| `OPENAI_API_KEY`  | yes      | API key for the LLM provider                                    |
| `OPENAI_BASE_URL` | no       | Base URL for non-OpenAI providers (Ollama, LiteLLM, etc)        |
| `OPENAI_MODEL`    | no       | Default model name (overridden by block `deepnote_agent_model`) |

**Exit codes:** 0 = success, 1 = runtime error, 2 = invalid usage.
