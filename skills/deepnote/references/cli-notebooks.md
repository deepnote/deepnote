# CLI: Notebook Commands

Install: `pnpm add -g @deepnote/cli`

## `deepnote notebooks rename <notebook-id> <new-name>`

Rename an existing notebook in Deepnote Cloud by its notebook id. This changes the cloud notebook
directly; it does not rename a notebook in a local `.deepnote` file.

An API token is required. Pass `--token`, or set `DEEPNOTE_TOKEN` in the environment or in a `.env` file in the current directory.

| Option                  | Description                                                            |
| ----------------------- | ---------------------------------------------------------------------- |
| `--url <url>`           | API base URL (default `https://api.deepnote.com`)                      |
| `--token <token>`       | Bearer token (or `DEEPNOTE_TOKEN` environment variable or `.env` file) |
| `-o, --output <format>` | Output format; the only supported machine-readable format is `json`    |

```bash
# Human-readable output
deepnote notebooks rename 7061f86dec6e4e11893288f295a82017 "Quarterly report"

# Machine-readable output
deepnote notebooks rename 7061f86dec6e4e11893288f295a82017 "Quarterly report" --output json
```

On success, text output identifies the renamed notebook and its resulting name. JSON output has this
shape:

```json
{
  "success": true,
  "notebook": {
    "id": "7061f86dec6e4e11893288f295a82017",
    "projectId": "project-id",
    "name": "Quarterly report"
  }
}
```

On failure, JSON output is `{ "success": false, "error": "..." }`.

## Rename Semantics and Conflicts

The API rejects a rename with a conflict when:

- another notebook in the project already uses the requested name
- the project is suspended
- the notebook belongs to a single-notebook or Agent project, where the project owns the notebook's
  name

Naming a notebook exactly `Init` designates it as the project's init notebook in Deepnote. This can
change execution behavior because the init notebook can run as a prelude to other notebooks in the
project; use `Init` only when that behavior is intended.

## Exit Codes

- `0`: notebook renamed successfully
- `1`: network, server, or other unexpected runtime failure
- `2`: invalid arguments or output format, missing token, authentication/authorization failure,
  notebook not found, or a rename conflict described above
