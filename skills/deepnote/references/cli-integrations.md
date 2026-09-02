# CLI: Integrations Commands

Install: `npm install -g @deepnote/cli`

Manage database integrations in a local integrations file (default: `.deepnote.env.yaml`). Secret values are never written to the YAML file — they are replaced with `env:` references and stored in a `.env` file (default: `.env`).

## `deepnote integrations pull`

Pull integrations from the Deepnote API and merge them into the local integrations file. Existing entries are updated in place, preserving comments, formatting, local-only integrations, and custom env var names.

| Option              | Description                                        | Default                    |
| ------------------- | -------------------------------------------------- | -------------------------- |
| `--url <url>`       | API base URL                                       | `https://api.deepnote.com` |
| `--token <token>`   | Bearer token (or use the `DEEPNOTE_TOKEN` env var) |                            |
| `--file <path>`     | Path to integrations file                          | `.deepnote.env.yaml`       |
| `--env-file <path>` | Path to `.env` file for storing secrets            | `.env`                     |

**Examples:**

```bash
# Pull integrations from the Deepnote API
deepnote integrations pull

# Pull with a specific token
deepnote integrations pull --token <token>

# Pull to a custom file path
deepnote integrations pull --file my-integrations.yaml
```

## `deepnote integrations add`

Add a new integration interactively. Prompts for the integration type, name, and type-specific connection fields.

| Option              | Description                             | Default              |
| ------------------- | --------------------------------------- | -------------------- |
| `--file <path>`     | Path to integrations file               | `.deepnote.env.yaml` |
| `--env-file <path>` | Path to `.env` file for storing secrets | `.env`               |

```bash
deepnote integrations add
deepnote integrations add --file my-integrations.yaml
```

## `deepnote integrations edit [id]`

Edit an existing integration interactively. Without `[id]`, shows a picker of the integrations found in the file.

| Option              | Description                             | Default              |
| ------------------- | --------------------------------------- | -------------------- |
| `--file <path>`     | Path to integrations file               | `.deepnote.env.yaml` |
| `--env-file <path>` | Path to `.env` file for storing secrets | `.env`               |

```bash
# Interactive picker
deepnote integrations edit

# Edit a specific integration by ID
deepnote integrations edit <integration-id>
```

## `deepnote integrations auth [id]`

Authenticate a `big-query` integration using Google OAuth so `deepnote run` can execute SQL blocks against it locally. Only `big-query` integrations with `authMethod: google-oauth` are supported; anything else is rejected. Without `[id]`, auto-picks the only matching integration, prompts with a picker if there are several, and fails if there are none. If `[id]` is not in the local integrations file, it is resolved from the Deepnote API instead, via `--token` or `DEEPNOTE_TOKEN`.

Opens a browser to complete Google's consent screen (also prints the URL, for headless sessions or if the browser fails to open) and stores the resulting refresh token under `~/.deepnote/federated-auth-tokens/` — one file per integration, mode `0600` in a `0700` directory on POSIX; on Windows confidentiality relies on the `%USERPROFILE%` ACL instead of the file mode. Requires a browser and a signed-in Deepnote session — interactive only, no headless or CI path (use service-account authentication for CI). Applies to local runs only: `--cloud` authenticates BigQuery server-side and never reads this token store.

| Option              | Description                                        | Default                    |
| ------------------- | -------------------------------------------------- | -------------------------- |
| `--file <path>`     | Path to integrations file                          | `.deepnote.env.yaml`       |
| `--env-file <path>` | Path to `.env` file                                | `.env`                     |
| `--domain <domain>` | Deepnote domain (OAuth consent proxy)              | `deepnote.com`             |
| `--url <url>`       | API base URL                                       | `https://api.deepnote.com` |
| `--token <token>`   | Bearer token (or use the `DEEPNOTE_TOKEN` env var) |                            |

**Examples:**

```bash
deepnote integrations auth
deepnote integrations auth <integration-id>
```

## Exit codes

**Exit codes:** 0 = success, 1 = runtime error, 2 = invalid usage (missing token, API error, or a malformed local integrations file).

## Malformed integrations file

All four subcommands read the local integrations file before writing anything. If the file exists but contains invalid YAML — most commonly unresolved git merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`), or a manual-edit typo — the command fails with **exit code 2** and an actionable message naming the file path and the parse error (with line and column):

```text
Invalid YAML in integrations file: .deepnote.env.yaml

Implicit keys need to be on a single line at line 2, column 1:

integrations:
<<<<<<< HEAD
^


This usually comes from unresolved merge conflict markers (<<<<<<<, =======, >>>>>>>) or a manual-edit typo.
Open the file, fix the reported line, and re-run the command — or delete the file manually if you no longer need its contents.
```

Nothing is repaired automatically and **no files are modified** — the integrations YAML and the `.env` file are both left untouched. Recovery is manual: fix the reported line, or delete the file if you no longer need its contents, then re-run the command.

For `integrations pull` this check runs on every invocation, including when the workspace has no integrations to pull.

`integrations pull`, `integrations edit`, and `integrations auth` fail before prompting for anything. `integrations add` collects the full connection config first and only reads the file afterwards, so the failure surfaces after the prompts rather than immediately — nothing entered at those prompts is written anywhere.
