# Publish command

`deepnote publish <path>` publishes either a static website or a Streamlit app to an existing
Deepnote project. The default static mode uploads a local directory below `_deepnote_static`,
replaces matching remote files, and enables static website sharing only after all file operations
succeed. `--streamlit` serves a file that is already in the project's Files without uploading it.

```bash
deepnote publish ./dist --project-id <uuid>
```

Authentication uses `--token` or `DEEPNOTE_TOKEN`. `--url` selects the API origin and defaults to
`https://api.deepnote.com`.

## Options

| Option                           | Behavior                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `--project-id <uuid>`            | Required target project id                                                                |
| `--streamlit`                    | Serve the project-relative path as a Streamlit app                                        |
| `--no-wait`                      | Streamlit only; exit once the app is created instead of waiting for it                    |
| `--path <prefix>`                | Static only; target directory; must be `_deepnote_static` or a directory below it         |
| `--api-access enabled\|disabled` | Static only; explicitly update API access; omitted means preserve the current setting     |
| `--prune`                        | Static only; delete remote files below `--path` that are absent from the local build      |
| `--sync-root <dir>`              | Static only; sync workspace whose mirror to update; default searches upwards from `<dir>` |
| `--no-sync-root`                 | Static only; publish without looking for or updating a sync workspace                     |
| `--force`                        | Static only; publish even when Deepnote holds changes the workspace has not synced        |
| `--token <token>`                | Deepnote API token; otherwise uses `DEEPNOTE_TOKEN`                                       |
| `--url <url>`                    | Deepnote API base URL                                                                     |
| `-q, --quiet`                    | Suppress progress and result output; errors remain visible on stderr                      |

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

## Change access without republishing

Use `deepnote static-site access` to change an existing site's access settings without uploading,
deleting, or otherwise modifying `_deepnote_static/**`:

```bash
# Stop serving the site while retaining its files
deepnote static-site access --project-id <uuid> --sharing disabled

# Serve the stored files again and enable viewer-scoped API calls
deepnote static-site access --project-id <uuid> --sharing enabled --api-access enabled

# Revoke viewer API access while preserving the current sharing setting
deepnote static-site access --project-id <uuid> --api-access disabled
```

At least one of `--sharing` and `--api-access` is required. Disabling sharing also disables viewer
API access. Re-enabling sharing later serves the retained files at the canonical URL returned by
Deepnote. The command uses the same `--token` / `DEEPNOTE_TOKEN` authentication and `--url` override
as `publish`.

## Coordination with `deepnote sync`

`_deepnote_static` is a subtree of the same project file store that `deepnote sync --all-files`
mirrors, so both commands write it. They share one baseline instead of splitting the namespace.

Unless `--no-sync-root` is given, publish searches upwards from `<dir>` for a `.deepnote-sync.json`
(or uses `--sync-root <dir>`). When one is found that tracks `--project-id`, publish additionally
writes each published file into that project's `.files/` mirror and records its size, content hash,
and server `updatedAt` in the manifest, exactly as a sync download would. The manifest, the mirror,
and Deepnote then agree, so the next sync treats the deploy as already in step rather than
re-downloading the whole site. A server that does not echo `updatedAt` on upload leaves those
baselines unverifiable until the next pull — the divergence stop does not cover such paths, and the
next pull re-downloads them once. `--prune` also removes the pruned paths from the mirror and manifest,
so a later push cannot resurrect them.

Before writing anything, publish compares the inventory it already fetched against the manifest
baseline. If a path it is about to write or prune has moved on in Deepnote since that workspace last
synced, publish exits 1 without mutating the project — the mirror holds no copy of that content.
Run `deepnote sync --all-files` to bring it down, or pass `--force` to overwrite. A path deleted in
Deepnote is not a stop: the deploy re-creates it from the build, and nothing is lost. Only an entry
recorded with the server's `updatedAt` is a usable baseline: `--all-files` syncs always record one,
publishes only when the server echoes it. A path without one is not flagged — the normal state of a
static root written by earlier publishes. A failure to update the mirror is a warning, not an error —
the deploy already succeeded, and the next sync brings the mirror back in step: a pull downloads the
published files again, a push surfaces them as a conflict.

The mirror is only updated when the tracked project's local directory already exists. Creating it
would make the next sync read the project as "every notebook was deleted locally" and push that, so
publish leaves the baseline stale instead; the next sync pulls the static files down once and
converges.

An explicit `--sync-root` that has no manifest, or whose manifest does not track the project, is
exit code 2. Note that the two `--prune` flags oppose each other: `publish --prune` deletes remote
files absent locally; `sync --prune` deletes local files absent from the cloud.

## Streamlit apps

`deepnote publish <path> --streamlit` serves a file that already exists in the project's Files as a
hosted Streamlit app. `<path>` is project-relative and must be canonical, such as
`apps/dashboard.py`. Nothing is uploaded: push the file first with `deepnote sync --all-files`
(files upload together with a notebook push) or upload it in Deepnote. A dynamic app that runs a
notebook also needs that notebook in the cloud project under the block ids its local `.deepnote`
file carries; `deepnote run <file> --cloud --push` aligns them before the first publish.

The command calls `POST /v2/streamlit-apps` with `{ projectId, entrypoint }`. Creating an app
restarts the project machine, which takes a few minutes and interrupts anyone working in the
project; the command prints that warning before creating. It then prints the app URL and polls
`GET /v2/streamlit-apps/{id}/status` every 5 seconds until the status is `running`, for up to 10
minutes. `unavailable` and `starting` are expected while the machine restarts, and transient
failures of the status request (429, 5xx, timeouts) are retried. `--no-wait` exits right after the
app is created.

Creation is not idempotent on the server: `POST` answers 409 when the file is already served. The
command then lists the project's apps (`GET /v2/streamlit-apps?projectId=`), reports the existing
app's id and URL, and changes nothing. Only a create restarts the machine, so if the existing app's
status is `unavailable` the command says the project machine is not running and exits 0 instead of
waiting; otherwise it waits as after a create unless `--no-wait` is given. Other 409s
(a suspended project, no free app port) are errors. A 404 for the entrypoint means the file is not
in the project's Files yet.

`--path`, `--api-access`, `--prune`, `--sync-root`, `--no-sync-root`, and `--force` are static-only
and rejected together with `--streamlit`; `--no-wait` is rejected without it. Streamlit mode does
not touch static website settings, the sync mirror, or the manifest.

## Examples

```bash
# Publish while preserving the current API-access setting
deepnote publish ./dist --project-id <uuid>

# Publish an app that loads notebooks or starts runs
deepnote publish ./dist --project-id <uuid> --api-access enabled

# Serve a file already in the project as a hosted Streamlit app and wait for it to start
deepnote publish apps/dashboard.py --project-id <uuid> --streamlit

# Create the Streamlit app without waiting for the machine to restart
deepnote publish apps/dashboard.py --project-id <uuid> --streamlit --no-wait

# Delete assets left behind by previous builds
deepnote publish ./dist --project-id <uuid> --prune

# Publish below a versioned subpath of the static root
deepnote publish ./dist --project-id <uuid> --path _deepnote_static/v2

# CI deploy: never look for or update a sync workspace
deepnote publish ./dist --project-id <uuid> --no-sync-root

# Stop serving the site without deleting the published files
deepnote static-site access --project-id <uuid> --sharing disabled
```

Exit code 0 means uploads and the sharing update succeeded. Exit code 1 means a project lookup,
upload, optional prune, or sharing update failed, or that Deepnote holds changes the sync workspace
has not pulled. Exit code 2 means invalid arguments, a missing token, an invalid local directory, or
a `--sync-root` that has no manifest, does not track the project, or whose tracked project
directory is missing, or a sync manifest that exists but cannot be read (pass `--no-sync-root` to
publish without it), or an option that does not apply to the chosen mode.

With `--streamlit`, exit code 0 means the app reported `running` (or, with `--no-wait`, was
created or already existed). Exit code 1 means the request failed or the app did not report
`running` within 10 minutes; the app still exists, so running the command again keeps waiting.

For `static-site access`, exit code 0 means the settings update succeeded, exit code 1 means the
project settings request failed, and exit code 2 means invalid arguments, a missing token, no
requested setting, or contradictory settings.
