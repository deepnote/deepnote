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

The notebook must already exist in Deepnote; `--cloud` does not upload local content, and
non-`.deepnote` inputs are rejected. Snapshots are written as a timestamped file plus a `latest`
copy, unless `--out <path>` is given (single file). `--input`, `--block`, `--notebook`, `--url`,
and `--token` are honored; local-only flags (`--python`, `--cwd`, `--top`, `--profile`, `--open`,
`--prompt`, `--dry-run`, `--list-inputs`, `--context`) are not.

`--input` follows the same rules as a local run: each value is typed by the input block it names,
and unknown names or invalid values are rejected before the run is triggered. Typing a value
requires the notebook's blocks, so `--input` needs the local `.deepnote` file — pass the file
rather than only `--notebook-id`.

**Machine output** (`-o json` / `-o toon`; `-o llm` resolves to `toon`):
`{ success, runId, status, snapshotPath?, timestampedSnapshotPath?, error? }`.
A completed run with status `error`/`internal_error`/`stopped` exits `1` but still reports the
`runId`, `status`, and any `snapshotPath`. A successful run whose snapshot cannot be downloaded or
saved also exits `1` (with `success: false` and an `error`).

```bash
# Run an existing cloud notebook by id and download its snapshot
DEEPNOTE_TOKEN=... deepnote run --cloud --notebook-id 0f1e2d3c-4b5a-6789-abcd-ef0123456789

# Run a .deepnote (notebook id read from the file) in the cloud, with inputs
DEEPNOTE_TOKEN=... deepnote run my-project.deepnote --cloud --input name="Alice"

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
