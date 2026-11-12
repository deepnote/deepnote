---
title: Publishing data apps and Streamlit apps with the Deepnote CLI
description: Publish an HTML, CSS, and JavaScript build as a data app with deepnote publish, or a Python entrypoint already in the project as a Streamlit app with deepnote streamlit publish
noIndex: false
noContent: false
---

The Deepnote CLI publishes data apps and Streamlit apps to an existing Deepnote project:

- **Data app:** an HTML page, with its CSS, JavaScript, and assets, hosted by a
  [data app project](/docs/data-app-projects) and backed by the project's notebook.
- **Streamlit app:** a Python UI that runs on the project's hardware.

Choose the command that matches your source:

| App type      | Source                                                 | Command                                                                  |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Data app      | A local directory of HTML, CSS, JavaScript, and assets | `deepnote publish ./dist --project-id <project-id>`                      |
| Streamlit app | A Python entrypoint already in the project's Files     | `deepnote streamlit publish apps/dashboard.py --project-id <project-id>` |

To have Deepnote Agent build the page for you instead, see [Data app projects](/docs/data-app-projects).

## Prerequisites

- For `deepnote publish`, a data app project. Create it as you publish with `--create <name>`, or in
  Deepnote: click **Create new** and choose **New data app**. `deepnote streamlit publish` needs an
  existing project and its ID.
- The Deepnote CLI: install with `npm install -g @deepnote/cli` or use `npx @deepnote/cli`.
- An API token with access to the project.

## Authentication

Create an API key in your workspace under **Settings & members → Security → API keys** (see the
[Deepnote API docs](/docs/deepnote-api)). Set `DEEPNOTE_TOKEN` in the environment or in a `.env` file
in the current directory, or pass `--token`:

```bash
export DEEPNOTE_TOKEN="<your-token>"
deepnote publish ./dist --project-id <project-id>
```

Prefer `DEEPNOTE_TOKEN` to keep the token out of command history and process arguments.
In CI, expose it from the provider's secret store. Keep tokens out of the build directory and revoke
any exposed token from the settings page. Without a token, all three commands (`publish`, `unpublish` and
`streamlit publish`) exit with code `2`.

## Finding a project ID

Copy the `project_id` UUID from the project's URL:

```text
https://deepnote.com/workspace/<workspace_name>-<workspace_id>/project/<project_name>-<project_id>/notebook/<notebook_name>-<notebook_id>
```

Inside a running notebook, the ID is also available as `DEEPNOTE_PROJECT_ID`.

## Data apps

Publish a dedicated build directory, such as a Vite build, a Next.js HTML export, or a directory
of HTML files:

```bash
deepnote publish ./dist --project-id <project-id>
```

For the first publish, `--create` makes the data app project for you, at the workspace root or in the
folder given by `--folder-id`:

```bash
deepnote publish ./dist --create "Revenue review"
```

The build directory is checked before anything is created, so a `.env` file or a bad path leaves no
empty project behind. The command prints the new project's ID; pass it as `--project-id` for later
publishes, since each `--create` makes another project. A new project isn't in a sync workspace, so
`--create` doesn't update one, and `--sync-root` is refused with it. If publishing fails after
`--create` made the project, the error names it, so you can retry with `--project-id` instead of
creating another.

A data app project has exactly one notebook, and the command prints its ID after publishing. A page
that runs the notebook through the API names this ID, so set it in the page and publish again. To
replace that notebook's blocks with a local `.deepnote` file, push it to that ID (this also runs the
notebook):

```bash
deepnote run app.deepnote --cloud --notebook-id <notebook-id> --push --yes
```

The command uploads files below `_deepnote_static`, replaces matching files, and publishes the app
after all uploads succeed, so people with access to the project can open it. Remote files absent from
the build are retained unless you use `--prune`. Use the URL printed by the command.

The project must be a data app project. For any other project type, the command exits with code `2`
before uploading anything. [Data app projects](/docs/data-app-projects) are in beta and may not be
enabled for your workspace yet. Publishing HTML files from a notebook project as a static website is no
longer supported.

<Callout status="warning">
Every file in the build directory can be served to viewers, including dotfiles and source maps.
Publish a clean build output directory that contains no credentials. As a safeguard, the command
refuses a directory that contains a `.env` or `.env.*` file at any depth (exit code `2`, nothing is
uploaded).
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

### Who can view a data app

Viewers must be signed in, have an active Deepnote account, and have project access. Workspace
members, project collaborators (including app users), and user groups can receive that access.
Project editors can always open the app; everyone else can open it once it is published.
Publishing also requires **Allow static file sharing in projects** in the workspace settings. These
permissions are checked on every request.

A published data app can also be [made public](/docs/data-app-projects#sharing-an-app-publicly), so
anyone with its link can open it, including people without a Deepnote account.

### Calling the API as the viewer

A published data app can read notebook inputs and run the project's notebook as the person viewing
it. Deepnote hands the page a viewer token that expires after 15 minutes. It can read notebook
inputs and block metadata (without source), read the notebook's
[app data](/docs/deepnote-api-runs#return-structured-data-from-a-notebook), start detached runs in this project or other projects
in the workspace where the viewer has direct access, and poll the viewer's own runs for their
`snapshotBlocks`. Runs in other projects also require execute permission. Visitors of a public app
can start runs only with **Execute** access and get an empty `snapshotBlocks` and no `error` for
them, so read their results from app data once the run succeeds. Every other endpoint
answers `403`, so features you built against a local preview with a personal token can fail in the
published app. See the
[cloud app example](https://github.com/deepnote/deepnote/tree/main/examples/local-runner/cloud-app)
for the token handshake.

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

### Unpublish a data app

```bash
deepnote unpublish --project-id <project-id>
```

`unpublish` makes the app editor-only again without changing its files. Run `deepnote publish` to
publish it again.

### Recover from a failed publish

Invalid local paths, conflicting destination paths, `.env` files, or files over 100 MiB in the build
directory stop the command before uploads, with exit code `2`. Each local file is read before its
remote copy is replaced.

If an upload fails, successful uploads remain in place, the app keeps its previous publish state, and
remaining stale files are not pruned. An app that was already published stays published and serves the
partly updated files, which can leave it unable to load. The command reports the failures and exits
with code `1`. Fix the reported errors and publish again. Replacement overwrites the remote file in
place rather than deleting it first, so the path is never empty, but a request that failed after the
server committed the replacement leaves the new version in place.

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
Sync overwrites changed files in place, so an edited entrypoint keeps its app and URL. Deleting the
entrypoint, or deleting and re-uploading it, removes the app; publishing again then creates a new
app with a new URL. Creating a replacement app restarts the machine.

If the app calls the public API, the project owner must enable Streamlit app API access and the
viewer must be signed in with direct project access. Streamlit viewer API access is limited to the
hosting project. If it runs a notebook, deploy that notebook before publishing and keep its block
IDs aligned with the local `.deepnote` file.

A missing-entrypoint error means the file must be uploaded first. After a startup timeout, the app
still exists; inspect it in Deepnote, start the project machine if it is stopped, and rerun publish
to check its status again.

## Options

`deepnote publish <dir>`:

| Option              | Description                                                 | Default                                |
| ------------------- | ----------------------------------------------------------- | -------------------------------------- |
| `--project-id <id>` | Target data app project; required unless `--create` is used |                                        |
| `--create <name>`   | Create a data app project with this name and publish to it  |                                        |
| `--folder-id <id>`  | Workspace folder for the project made by `--create`         | workspace root                         |
| `--path <prefix>`   | Target directory at or below `_deepnote_static`             | `_deepnote_static`                     |
| `--prune`           | Delete remote files absent from the build                   | `false`                                |
| `--sync-root <dir>` | Sync workspace to update                                    | search upward from the build directory |
| `--no-sync-root`    | Skip sync workspace discovery and updates                   | `false`                                |
| `--force`           | Overwrite changes not pulled into the workspace             | `false`                                |
| `--token <token>`   | API token                                                   | `DEEPNOTE_TOKEN`                       |
| `--url <url>`       | API origin                                                  | `https://api.deepnote.com`             |
| `-q, --quiet`       | Suppress progress and results; errors remain on stderr      | `false`                                |

`deepnote streamlit publish <entrypoint>`:

| Option              | Description                                            | Default                    |
| ------------------- | ------------------------------------------------------ | -------------------------- |
| `--project-id <id>` | Target project (required)                              |                            |
| `--no-wait`         | Return without checking readiness                      | `false`                    |
| `--token <token>`   | API token                                              | `DEEPNOTE_TOKEN`           |
| `--url <url>`       | API origin                                             | `https://api.deepnote.com` |
| `-q, --quiet`       | Suppress progress and results; errors remain on stderr | `false`                    |

## Exit codes

| Code | `deepnote publish`                                                                                                                           | `deepnote streamlit publish`                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `0`  | Files uploaded and the app published                                                                                                         | App running, or created/found with `--no-wait` |
| `1`  | A request, upload, prune, or publishing failed; or unsynced remote changes                                                                   | A request failed or startup timed out          |
| `2`  | Not a data app project, invalid arguments, missing token/directory, `.env` or over-100 MiB file in the directory, or unusable sync workspace | Invalid arguments or missing token             |

Without `--no-wait`, a Streamlit app that remains unavailable exits with code `1` after the startup
timeout.

For `unpublish`, exit codes are `0` for success, `1` for a request failure (including a project that
is not a data app), and `2` for invalid arguments or a missing token.

## Related

- [Deepnote CLI](/docs/deepnote-cli) — install the CLI and see every command
- [Syncing a workspace with the Deepnote CLI](/docs/deepnote-cli-sync) — mirror projects to a local
  directory and push notebook edits back
- [Deepnote file sync](/docs/deepnote-file-sync) — the in-product feature that keeps a project synced
  with a `.deepnote` file in a Git repository
- [Data app projects](/docs/data-app-projects) — building data apps with Deepnote Agent
