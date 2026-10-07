# CLI: Analysis Commands

Install: `npm install -g @deepnote/cli`

`--python <path>` is optional everywhere it appears below. When omitted, `analyze`, `dag`, and `lint` of a `.deepnote` file use `DEEPNOTE_PYTHON` if set, otherwise the Deepnote editor extension's environment for the project (from `.vscode/deepnote.json`, `.cursor/deepnote.json`, or `.antigravity/deepnote.json`), otherwise a `.venv` or `venv` above the notebook that has `deepnote-toolkit` installed, otherwise the analyzer's default `python3`. Linting an integrations YAML file directly runs no Python, so `--python` has no effect there. See `cli-run.md` for the full order.

## `deepnote inspect [path]`

Display structured metadata about a .deepnote file.

| Option                  | Description                          |
| ----------------------- | ------------------------------------ |
| `-o, --output <format>` | Output format: `json`, `toon`, `llm` |

Smart file discovery: if no path is given, finds the first `.deepnote` file in the current directory.

**Examples:**

```bash
deepnote inspect my-project.deepnote
deepnote inspect my-project.deepnote -o json
deepnote inspect  # auto-discover in current directory
```

## `deepnote cat <path>`

Display block contents from a .deepnote file.

| Option                  | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm`                                     |
| `--notebook <name>`     | Show only blocks from specified notebook                         |
| `--type <type>`         | Filter by block type: `code`, `sql`, `markdown`, `text`, `input` |
| `--tree`                | Show structure only without content                              |

**Examples:**

```bash
# Show all blocks
deepnote cat my-project.deepnote

# Show only code blocks
deepnote cat my-project.deepnote --type code

# Show only blocks from a specific notebook
deepnote cat my-project.deepnote --notebook "Analysis"

# Tree view (structure without content)
deepnote cat my-project.deepnote --tree

# Combine filters
deepnote cat my-project.deepnote --notebook "Analysis" --type sql
```

## `deepnote diff <path1> <path2>`

Compare two .deepnote files and show structural differences.

| Option                  | Description                           |
| ----------------------- | ------------------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm`          |
| `--content`             | Include content differences in output |

**Examples:**

```bash
deepnote diff original.deepnote modified.deepnote
deepnote diff file1.deepnote file2.deepnote --content
deepnote diff current.deepnote backup.snapshot.deepnote
```

## `deepnote validate <path>`

Validate a .deepnote file against the schema.

| Option                  | Description                  |
| ----------------------- | ---------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm` |

**Exit codes:** 0 = valid, 1 = runtime error, 2 = invalid file or invalid usage.

**Examples:**

```bash
deepnote validate my-project.deepnote
deepnote validate my-project.deepnote -o json
deepnote validate my-project.deepnote && echo "Valid!"
```

## `deepnote audit [dir]`

Audit a synced workspace — the tree `deepnote sync` writes. Answers what `lint --governance` cannot
from one project: which integrations exist and who uses them, where data leaves to, and which
credentials are shared across projects. Everything is local: no warehouse connection, no Python.

| Option                  | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm`                         |
| `--project <name>`      | Audit a single project, by name or id                |
| `--issues`              | List every finding instead of a count per check      |
| `--internal-domain <d>` | A domain belonging to your organization (repeatable) |

**Workspace-scoped checks:**

| Code                             | Finding                                                                | Severity |
| -------------------------------- | ---------------------------------------------------------------------- | -------- |
| `ingress-integration-orphan`     | Declared integration no SQL block uses; its credentials are still live | warning  |
| `ingress-integration-undeclared` | SQL block runs against an integration the project does not declare     | warning  |
| `egress-external`                | Code block writes to a host outside Deepnote and the integrations      | warning  |
| `credential-shared`              | The same credential is hardcoded in more than one project              | error    |
| `pii-subject-scatter`            | One person's data appears in more than one notebook                    | warning  |
| `asset-stale`                    | A notebook untouched for three years or more                           | warning  |

Every project is also run through the `lint --governance` checks, so one audit covers both scopes.
Findings carry `projectId`, `projectName` and `path` on top of the usual lint issue fields.

Findings are **ranked**, not gated: `severity = signal × exposure × neglect × blast radius`, and
`issue.score` carries all four factors plus the product. Blast radius is liveness-weighted — a table
referenced by 168 projects of which 19 are live is scored on the 19 — and neglect never lowers a
score, so a credential in an abandoned notebook ranks above one in a live notebook (the key still
works). `signal` and `exposure` are judgment constants, not measured precision.

The report also inventories `tables` (name, `projectCount`, `liveProjectCount`, `blockCount`) and
`staleness` (live / aging / cold / undated notebooks, median age). An undated notebook is never
reported as abandoned.

`-o json` adds `flow`: `nodes` for every integration, project and host, and `edges` between them
(`reads` from an integration into a project, `writes`/`calls` from a project out to a host). It is
data, not a drawing — render it however you need.

**Limits the report states on every run:** egress only sees hosts written into block content, not
ones assembled at run time; integration usage counts SQL blocks in notebooks only (dbt and BI tools
are invisible); and cross-project consensus checks are not run below roughly 100 projects.

**Exit codes:** 0 = the workspace was audited (findings never fail the command — audit is an
inventory, not a gate; use `lint --governance` in CI), 1 = the workspace could not be read, 2 =
invalid usage.

**Examples:**

```bash
deepnote audit workspace
deepnote audit workspace --issues
deepnote audit workspace --project "Churn analysis"
deepnote audit workspace -o json
```

## `deepnote lint [path]`

Check a .deepnote file or integrations yaml file for issues. `[path]` is optional and defaults to the current directory. You can also lint an integrations yaml file (e.g. `.deepnote.env.yaml`) directly by passing it as the path argument, which validates the file structure, integration schemas, and environment variable references.

| Option                       | Description                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `-o, --output <format>`      | Output format: `json`, `llm`                                                         |
| `--notebook <name>`          | Lint only a specific notebook                                                        |
| `--python <path>`            | Path to Python interpreter                                                           |
| `--integrations-file <path>` | Path to integrations env file (default: `.deepnote.env.yaml` next to .deepnote file) |
| `--governance`               | Also run the governance checks (see below)                                           |

**Checks performed:**

- **Variables:** undefined, circular dependencies, unused, shadowed, parse errors
- **Integrations:** SQL blocks using missing integrations, plus configuration errors in the integrations file (YAML syntax, schema, missing env vars)
- **Inputs:** Input blocks without default values

**Governance checks (`--governance` only):**

| Code                   | Finding                                                                   | Severity |
| ---------------------- | ------------------------------------------------------------------------- | -------- |
| `sql-null-comparison`  | `= NULL` / `!= NULL`, which never matches a row — use `IS NULL`           | error    |
| `sql-tautology`        | A column compared to itself, so the join or filter is a no-op             | error    |
| `sql-string-boolean`   | A column compared to the string `'true'`/`'false'` instead of the keyword | warning  |
| `credential-hardcoded` | A credential written into a block                                         | error \* |

\* The pattern rules (AWS keys, GitHub and Slack tokens, private keys, connection-string passwords)
report an error; the heuristic rule — a long literal assigned to a secret-named variable — reports a
warning. Prose blocks are scanned with the pattern rules only.

Credentials are reported as a truncated SHA-256 fingerprint in `details.fingerprint`, never by
value, and `details.blockCount` says how many blocks share that fingerprint. Never echo a matched
credential back into a notebook, a commit message, or a ticket.

The SQL checks tokenize the query text, so they run without a warehouse connection, a schema, or a
Python interpreter. `sql-null-comparison` and `sql-tautology` hold in every dialect.
`sql-string-boolean` consults the block's `sql_integration_id`: a double-quoted `"true"` is a
string literal on MySQL, MariaDB and BigQuery and is reported, and a quoted _column name_ on the
identifier-quoting dialects, where it is not. A block with no integration, or one the project does
not declare, is treated as identifier-quoting and not reported.

A block that holds a credential is labelled `<type> (<short id>)` instead of its first line, in
every issue raised against it by any rule. For the one-line `TOKEN = "…"` assignment the credential
checks most often fire on, that first line is the secret itself.

`--governance` is project-scoped. The workspace-scoped checks — duplicated metric definitions,
personal data scattered across notebooks, writes to third-party hosts, abandoned assets — compare
projects against each other and cannot be answered from one file; lint prints the scope it covered
instead of returning an empty result. `--governance` is ignored when linting an integrations YAML
file directly (it has no blocks) and warns on stderr.

With `-o json`, a `governance` object reports `scope`, the `checks` that ran, how many blocks were
`scanned`, and the distinct `credentialFingerprints`. The key is absent when `--governance` was not
passed.

Integrations are automatically loaded from `.deepnote.env.yaml` in the same directory as the .deepnote file (or from `--integrations-file` if specified).

**Exit codes:** 0 = no errors (warnings OK), 1 = errors found (including configuration errors), 2 = invalid usage.

**Examples:**

```bash
deepnote lint my-project.deepnote
deepnote lint .deepnote.env.yaml
deepnote lint my-project.deepnote -o json
deepnote lint my-project.deepnote --notebook "Analysis"
deepnote lint my-project.deepnote --integrations-file prod-integrations.yaml
deepnote lint my-project.deepnote --governance
deepnote lint my-project.deepnote --governance -o json
```

## `deepnote stats <path>`

Show statistics about a .deepnote file.

| Option                  | Description                      |
| ----------------------- | -------------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm`     |
| `--notebook <name>`     | Analyze only a specific notebook |

**Examples:**

```bash
deepnote stats my-project.deepnote
deepnote stats my-project.deepnote -o json
```

## `deepnote analyze <path>`

Comprehensive analysis with quality score (0-100).

| Option                  | Description                          |
| ----------------------- | ------------------------------------ |
| `-o, --output <format>` | Output format: `json`, `toon`, `llm` |
| `--notebook <name>`     | Analyze only a specific notebook     |
| `--python <path>`       | Path to Python interpreter           |

**Examples:**

```bash
deepnote analyze my-project.deepnote
deepnote analyze my-project.deepnote -o toon
```

## `deepnote dag`

Dependency analysis subcommands.

### `deepnote dag show <path>`

Show the dependency graph between blocks.

| Option                  | Description                         |
| ----------------------- | ----------------------------------- |
| `-o, --output <format>` | Output format: `json`, `dot`, `llm` |
| `--notebook <name>`     | Analyze only a specific notebook    |
| `--python <path>`       | Path to Python interpreter          |

```bash
deepnote dag show my-project.deepnote
deepnote dag show my-project.deepnote -o dot | dot -Tpng -o deps.png
```

### `deepnote dag vars <path>`

List variables defined and used by each block.

| Option                  | Description                      |
| ----------------------- | -------------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm`     |
| `--notebook <name>`     | Analyze only a specific notebook |
| `--python <path>`       | Path to Python interpreter       |

```bash
deepnote dag vars my-project.deepnote
```

### `deepnote dag downstream <path>`

Show blocks that need re-run if a block changes.

| Option                  | Description                             |
| ----------------------- | --------------------------------------- |
| `-b, --block <id>`      | Block ID or label to analyze (required) |
| `-o, --output <format>` | Output format: `json`, `llm`            |
| `--notebook <name>`     | Analyze only a specific notebook        |
| `--python <path>`       | Path to Python interpreter              |

```bash
deepnote dag downstream my-project.deepnote --block "Load Data"
```
