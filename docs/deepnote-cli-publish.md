---
title: Publishing apps and Streamlit apps with the Deepnote CLI
description: Publish HTML, CSS, and JavaScript as an app with deepnote publish, or a Python entrypoint already in the project as a Streamlit app with deepnote streamlit publish
noIndex: false
noContent: false
---

The Deepnote CLI publishes apps and Streamlit apps to an existing Deepnote project:

- **App:** HTML, CSS, JavaScript, and assets hosted by Deepnote and run in the browser.
- **Streamlit app:** a Python UI that runs on the project's hardware.

Choose the command that matches your source:

| App type      | Source                                                 | Command                                                                  |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| App           | A local directory of HTML, CSS, JavaScript, and assets | `deepnote publish ./dist --project-id <project-id>`                      |
| Streamlit app | A Python entrypoint already in the project's Files     | `deepnote streamlit publish apps/dashboard.py --project-id <project-id>` |

Apps can be interactive and run notebooks through the Deepnote API. To publish notebook blocks
through the Deepnote editor instead, see [Data apps](/docs/data-apps).

## Prerequisites

- An existing Deepnote project and its ID.
- The Deepnote CLI: install with `npm install -g @deepnote/cli` or use `npx @deepnote/cli`.
- An API token with access to the project.

## Authentication

Create a token under [Settings & members → API tokens](https://deepnote.com/workspace/settings/api-tokens).
Set `DEEPNOTE_TOKEN`, or pass `--token`:

```bash
export DEEPNOTE_TOKEN="<your-token>"
deepnote publish ./dist --project-id <project-id>
```

Prefer the environment variable to keep the token out of command history and process arguments.
In CI, expose it from the provider's secret store. Keep tokens out of the build directory and revoke
any exposed token from the settings page. Without a token, all three commands exit with code `2`.

## Finding a project ID

Copy the `project_id` UUID from the project's URL:

```text
https://deepnote.com/workspace/<workspace_name>-<workspace_id>/project/<project_name>-<project_id>/notebook/<notebook_name>-<notebook_id>
```

Inside a running notebook, the ID is also available as `DEEPNOTE_PROJECT_ID`.

## Apps

Publish a dedicated build directory, such as a Vite build, a Next.js HTML export, or a directory
of HTML files:

```bash
deepnote publish ./dist --project-id <project-id>
```

The command uploads files below `_deepnote_static`, replaces matching files, and enables sharing
after all uploads succeed. Remote files absent from the build are retained unless you use `--prune`.
Use the URL printed by the command.

<Callout status="warning">
Every file in the build directory can be served to viewers, including dotfiles, source maps, and
`.env` files. Publish a clean build output directory that contains no credentials.
</Callout>

### Where the files go

`dist/index.html` is uploaded as `_deepnote_static/index.html`. Use `--path` to publish below a
subdirectory, for example to keep separate versions:

```bash
deepnote publish ./dist --project-id <project-id> --path _deepnote_static/v2
```

The target must be `_deepnote_static` or a directory below it. The printed URL includes that path
with special characters encoded. Deepnote serves `index.html` for directory URLs; other URLs must
match the filename, such as `about.html`.

### Who can view an app

Viewers must be signed in, have an active Deepnote account, and have project access. Workspace
members, project collaborators (including app users), and user groups can receive that access.
Sharing also requires the workspace to allow app file sharing and a plan that supports the feature.
These permissions are checked on every request.

Apps have no anonymous or link-only access. If the audience needs those access levels,
consider [Data apps](/docs/data-apps).

### Viewer API access

Enable API access when an app needs to read notebook inputs or start runs:

```bash
deepnote publish ./dist --project-id <project-id> --api-access enabled
```

The embedded app can request a viewer token from the Deepnote shell. It can read notebook
inputs and block metadata and start detached runs in the hosting project or other projects in the
same workspace where the viewer has direct access. Starting runs in other projects also requires
execute permission. It can poll that viewer's own runs for `snapshotBlocks`. It cannot read block source, list notebooks or run history, or call other API
endpoints; unsupported requests return 403.

Use `postMessage` with `deepnote-static-files-api-token-request` to request a token. Pin the shell
origin when sending and receiving messages, then use the API origin returned with the token.
Tokens expire after 15 minutes; request a replacement before expiry and on a 401.
The [cloud app example](https://github.com/deepnote/deepnote/tree/main/examples/local-runner/cloud-app)
demonstrates the handshake and refresh.

API access requires app sharing and does not grant additional viewers project access. Omitting
`--api-access` preserves the current setting; use `--api-access disabled` to revoke it. Test the
hosted app with a viewer token, since a personal token in a local preview has broader permissions.

### Remove files from an earlier build

```bash
deepnote publish ./dist --project-id <project-id> --prune
```

`--prune` deletes remote files below the target path that are absent from the build. Stale files
blocking required directories are removed before uploading; other stale files are removed only
after all uploads succeed.

`publish --prune` deletes **remote** files. [`sync --prune`](/docs/deepnote-cli-sync) deletes
**local** files absent from Deepnote.

### Work with a sync workspace

When publishing from a synced workspace, publish also updates its `.files/` mirror and
`.deepnote-sync.json`. Use `--sync-root <dir>` to select a workspace, or `--no-sync-root` to skip
workspace updates, for example in CI.

If a file to be replaced or pruned changed remotely since the workspace's recorded baseline,
publish stops before writing. Pull and reconcile the changes with `deepnote sync --all-files`,
or use `--force` to overwrite them. This check requires a recorded server `updatedAt`; files
without that baseline are not protected by it.

### Change access without republishing

Use the `static-site access` command to change an app's settings without changing its files:

```bash
# Stop serving the app and disable viewer API access
deepnote static-site access --project-id <project-id> --sharing disabled

# Serve the retained files again
deepnote static-site access --project-id <project-id> --sharing enabled
```

Use `--api-access enabled|disabled` to change viewer API access. At least one setting is required.

### Recover from a failed publish

Invalid local paths or conflicting destination paths stop the command before uploads, with exit
code `2`. Each local file is read before its remote copy is deleted and replaced.

If an upload fails, successful uploads remain in place, sharing is not changed, and remaining stale
files are not pruned. The command reports the failures and exits with code `1`. Fix the reported
errors and publish again. Replacement uses a delete followed by an upload, so an overwritten file
is briefly unavailable.

## Streamlit apps

Upload the entrypoint and its dependencies to the project's Files in Deepnote before publishing.
If a notebook push is already pending in a sync workspace, `deepnote sync --all-files` can include
the working files. For a `.py`-only edit, upload in Deepnote; sync does not push that edit alone.

Pass the project-relative path:

```bash
deepnote streamlit publish apps/dashboard.py --project-id <project-id>
```

<Callout status="warning">
Creating a Streamlit app restarts the project machine and interrupts anyone working in the project.
</Callout>

The command prints the app URL and waits up to 10 minutes for `running`. If the entrypoint is
already served, it reports the existing app ID and URL without restarting the machine. It waits
for that app too: `unavailable` can be a temporary state during a restart.
Use `--no-wait` to return after creation or lookup without checking readiness.

Deleting the entrypoint can remove its app registration, but some apps created in the UI retain it.
Sync replaces changed files by deleting and uploading them. After syncing an edited entrypoint,
publish again and use the returned URL; it may change. Creating a replacement app restarts the machine.

If the app calls the public API, the project owner must enable Streamlit app API access and the
viewer must be signed in with direct project access. Streamlit viewer API access is limited to the
hosting project. If it runs a notebook, deploy that notebook before publishing and keep its block
IDs aligned with the local `.deepnote` file.

A missing-entrypoint error means the file must be uploaded first. After a startup timeout, the app
still exists; inspect it in Deepnote, start the project machine if it is stopped, and rerun publish
to check its status again.

## Options

`deepnote publish <dir>`:

| Option                           | Description                                            | Default                                |
| -------------------------------- | ------------------------------------------------------ | -------------------------------------- |
| `--project-id <id>`              | Target project (required)                              |                                        |
| `--path <prefix>`                | Target directory at or below `_deepnote_static`        | `_deepnote_static`                     |
| `--api-access enabled\|disabled` | Change viewer API access                               | unchanged                              |
| `--prune`                        | Delete remote files absent from the build              | `false`                                |
| `--sync-root <dir>`              | Sync workspace to update                               | search upward from the build directory |
| `--no-sync-root`                 | Skip sync workspace discovery and updates              | `false`                                |
| `--force`                        | Overwrite changes not pulled into the workspace        | `false`                                |
| `--token <token>`                | API token                                              | `DEEPNOTE_TOKEN`                       |
| `--url <url>`                    | API origin                                             | `https://api.deepnote.com`             |
| `-q, --quiet`                    | Suppress progress and results; errors remain on stderr | `false`                                |

`deepnote streamlit publish <entrypoint>`:

| Option              | Description                                            | Default                    |
| ------------------- | ------------------------------------------------------ | -------------------------- |
| `--project-id <id>` | Target project (required)                              |                            |
| `--no-wait`         | Return without checking readiness                      | `false`                    |
| `--token <token>`   | API token                                              | `DEEPNOTE_TOKEN`           |
| `--url <url>`       | API origin                                             | `https://api.deepnote.com` |
| `-q, --quiet`       | Suppress progress and results; errors remain on stderr | `false`                    |

## Exit codes

| Code | `deepnote publish`                                                              | `deepnote streamlit publish`                   |
| ---- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| `0`  | Files uploaded and sharing enabled                                              | App running, or created/found with `--no-wait` |
| `1`  | A request, upload, prune, or settings update failed; or unsynced remote changes | A request failed or startup timed out          |
| `2`  | Invalid arguments, missing token/directory, or unusable sync workspace          | Invalid arguments or missing token             |

Without `--no-wait`, a Streamlit app that remains unavailable exits with code `1` after the startup
timeout.

For `static-site access`, exit codes are `0` for success, `1` for a request failure, and `2` for
invalid arguments, a missing token, or missing/contradictory settings.

## Related

- [Syncing a workspace with the Deepnote CLI](/docs/deepnote-cli-sync) — mirror projects to a local
  directory and push notebook edits back
- [Deepnote file sync](/docs/deepnote-file-sync) — the in-product feature that keeps a project synced
  with a `.deepnote` file in a Git repository
- [Data apps](/docs/data-apps) — building interactive apps on Deepnote
