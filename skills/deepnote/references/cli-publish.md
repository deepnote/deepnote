# Publish command

`deepnote publish <dir>` uploads a local static website to an existing Deepnote project. It places
files below `_deepnote_static`, replaces matching remote files, and enables static website sharing
only after all file operations succeed.

```bash
deepnote publish ./dist --project-id <uuid>
```

Authentication uses `--token` or `DEEPNOTE_TOKEN`. `--url` selects the API origin and defaults to
`https://api.deepnote.com`.

## Options

| Option                           | Behavior                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| `--project-id <uuid>`            | Required target project id                                               |
| `--path <prefix>`                | Target directory; must be `_deepnote_static` or a directory below it     |
| `--api-access enabled\|disabled` | Explicitly update API access; omitted means preserve the current setting |
| `--prune`                        | Delete remote files below `--path` that are absent from the local build  |
| `--token <token>`                | Deepnote API token; otherwise uses `DEEPNOTE_TOKEN`                      |
| `--url <url>`                    | Deepnote API base URL                                                    |
| `-q, --quiet`                    | Suppress progress and result output                                      |

Publishing reads the project inventory, then replaces each matching file with a delete followed by
an upload. Before any remote mutation, it rejects local paths the file API would normalize
differently or that collide at the destination. If an upload fails, the command reports exit code 1
and does not prune or change project settings. With `--prune`, stale files are deleted only after all
uploads succeed. Finally, the command enables sharing through `PATCH /v2/projects/{id}` when the
current settings differ and prints the canonical website URL returned by the server. Nested target
path segments are percent-encoded in that URL.

API access is security-sensitive and is not enabled by default. Pass `--api-access enabled` when the
website needs a static-app viewer token to call allowed Deepnote endpoints. Pass
`--api-access disabled` to turn it off explicitly.

## Examples

```bash
# Publish while preserving the current API-access setting
deepnote publish ./dist --project-id <uuid>

# Publish an app that loads notebooks or starts runs
deepnote publish ./dist --project-id <uuid> --api-access enabled

# Delete assets left behind by previous builds
deepnote publish ./dist --project-id <uuid> --prune

# Publish below a versioned subpath of the static root
deepnote publish ./dist --project-id <uuid> --path _deepnote_static/v2
```

Exit code 0 means uploads and the sharing update succeeded. Exit code 1 means a project lookup,
upload, optional prune, or sharing update failed. Exit code 2 means invalid arguments, a missing
token, or an invalid local directory.
