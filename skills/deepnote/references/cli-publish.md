# Publish command

`deepnote publish <path>` publishes either a static website or a Streamlit app to an existing
Deepnote project. The default static mode uploads a local directory below `_deepnote_static`,
replaces matching remote files, and enables static website sharing only after all file operations
succeed. `--streamlit` serves an existing project-relative file without uploading it.

```bash
deepnote publish ./dist --project-id <uuid>
```

Authentication uses `--token` or `DEEPNOTE_TOKEN`. `--url` selects the API origin and defaults to
`https://api.deepnote.com`.

## Options

| Option                           | Behavior                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| `--project-id <uuid>`            | Required target project id                                           |
| `--streamlit`                    | Serve the project-relative path as a Streamlit app                   |
| `--path <prefix>`                | Static only; target at or below `_deepnote_static`                   |
| `--api-access enabled\|disabled` | Static only; explicitly update API access                            |
| `--prune`                        | Static only; delete remote files absent from the local build         |
| `--token <token>`                | Deepnote API token; otherwise uses `DEEPNOTE_TOKEN`                  |
| `--url <url>`                    | Deepnote API base URL                                                |
| `-q, --quiet`                    | Suppress progress and result output; errors remain visible on stderr |

Publishing reads the project inventory, then replaces each matching file with a delete followed by
an upload. Before any remote mutation, it rejects local paths the file API would normalize
differently or that collide at the destination. If an upload fails, the command reports exit code 1
and does not prune remaining stale files or change project settings. With `--prune`, stale files that
block required directories are deleted before uploading; remaining stale files are deleted only
after all uploads succeed. Finally, the command enables sharing through `PATCH /v2/projects/{id}`
when the current settings differ and prints the canonical website URL returned by the server. Nested
target path segments are percent-encoded in that URL.

API access is security-sensitive and is not enabled by default. Pass `--api-access enabled` when the
website needs a static-app viewer token to call allowed Deepnote endpoints. Pass
`--api-access disabled` to turn it off explicitly.

In Streamlit mode, `<path>` must be a canonical project-relative path such as
`apps/dashboard.py`. The file must already exist in the project's Files. The command calls
`POST /v2/streamlit-apps` with `{ projectId, entrypoint }` and prints the returned app URL. It does
not upload the file, change static website settings, or make duplicate creation idempotent; the API
returns 409 when that entrypoint is already served. `--path`, `--api-access`, and `--prune` are
invalid together with `--streamlit`.

## Examples

```bash
# Publish while preserving the current API-access setting
deepnote publish ./dist --project-id <uuid>

# Publish an app that loads notebooks or starts runs
deepnote publish ./dist --project-id <uuid> --api-access enabled

# Serve an existing project file as a hosted Streamlit app
deepnote publish apps/dashboard.py --project-id <uuid> --streamlit

# Delete assets left behind by previous builds
deepnote publish ./dist --project-id <uuid> --prune

# Publish below a versioned subpath of the static root
deepnote publish ./dist --project-id <uuid> --path _deepnote_static/v2
```

Exit code 0 means publishing succeeded. Exit code 1 means an API request, upload, optional prune,
or sharing update failed. Exit code 2 means invalid arguments, incompatible mode options, a missing
token, or an invalid static directory.
