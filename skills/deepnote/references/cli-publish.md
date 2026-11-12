# Publish data apps and Streamlit apps

Two commands publish to an existing Deepnote project. Choose the command from the source:

- **Data app:** a local directory of HTML, CSS, JavaScript, and assets, uploaded to a data app
  project for Deepnote to host: `deepnote publish <dir> --project-id <uuid>`.
- **Streamlit app:** a project-relative `.py` entrypoint already in the project's Files:
  `deepnote streamlit publish <entrypoint> --project-id <uuid>`.

If the workflow is undecided, start with [Build and publish apps and Streamlit apps](apps.md).

## Before publishing

1. Confirm the target project and the files to publish. `publish` needs a data app project and
   refuses any other project type with exit code 2 before uploading. For a first publish, pass
   `--create <name>` instead of `--project-id` and it creates one; otherwise the user creates it in
   Deepnote (**Create new → New data app**). `streamlit publish` never creates projects.
2. Set `DEEPNOTE_TOKEN` in the environment or in a `.env` file in the current directory, or pass
   `--token`. Use `--url` only to override the default API origin, `https://api.deepnote.com`.
   Keep the token out of app files.
3. For an app, build into a dedicated directory and inspect its contents. Everything in that
   directory will be uploaded, including dotfiles; `publish` refuses a directory containing a `.env`
   or `.env.*` file at any depth, or a file over 100 MiB (exit code 2).
4. For a new Streamlit app, account for the project-machine restart and interruption to active work.

## Publish a data app

```bash
deepnote publish ./dist --project-id <uuid>

# First publish: create the data app project
deepnote publish ./dist --create "Revenue review"
```

`--create` validates the build before creating anything and prints the new project ID. Record it and
use `--project-id` from then on; every `--create` makes another project. It never updates a sync
workspace and refuses `--sync-root`. If a publish fails after `--create`, the error names the
created project; retry with `--project-id` rather than creating another.

A data app project has exactly one notebook, and `publish` prints its ID. A page that starts runs
must name it. Put a local notebook into the project with
`deepnote run <file> --cloud --notebook-id <id> --push --yes`; the project cannot hold a second
notebook. Module blocks must name the module notebooks' IDs in Deepnote, which can differ from the IDs
in the file the modules were imported from.

Matching files under `_deepnote_static` are replaced. Files absent from the local build are retained,
and the app is published after uploads succeed, so people with project access can open it. Use the
returned URL and verify the hosted app's assets and navigation.

Add only the options the deployment needs:

```bash
# Remove remote files left over from earlier builds
deepnote publish ./dist --project-id <uuid> --prune

# Keep a version under a separate path
deepnote publish ./dist --project-id <uuid> --path _deepnote_static/v2

# Publish from CI without a local sync workspace
deepnote publish ./dist --project-id <uuid> --no-sync-root
```

A published data app always has viewer API access. If the page runs notebooks, implement and verify
[viewer API access](apps.md#add-viewer-api-access), including token refresh, before publishing. A
personal token in a local preview has broader permissions than a hosted viewer token.

### Work with a sync workspace

Keep the build directory inside the sync workspace, or pass `--sync-root <dir>` to select one.
Publish updates its `.files/` mirror and `.deepnote-sync.json`, including pruned files. Deploy build
output through `publish`; use `sync` to pull remote edits and resolve conflicts.

If publish reports remote changes, run `deepnote sync --all-files` and reconcile them before
retrying. Use `--force` only when those remote changes should be overwritten. The conflict check
covers files about to be replaced or pruned that have a recorded server `updatedAt`; files without
that baseline are not protected by this check.

An explicit `--sync-root` must track the target project and have its local project directory.
If publish warns that the mirror could not be updated, the remote deployment has still succeeded;
sync again to refresh the local state. Use `--no-sync-root` when no workspace should be updated.

`publish --prune` deletes **remote** files absent from the build. `sync --prune` deletes **local**
files absent from Deepnote.

## Publish a Streamlit app

1. Upload the entrypoint and its local dependencies to the project's Files in Deepnote. If a
   notebook push is already pending in a sync workspace, use `deepnote sync --all-files` to include
   the working files. For a `.py`-only edit, upload in Deepnote; sync does not push that edit alone.
2. If the app runs a notebook, deploy it with the matching block IDs before publishing. See
   [Prepare a Streamlit app](apps.md#prepare-a-streamlit-app).
3. Publish using the project-relative path:

   ```bash
   deepnote streamlit publish apps/dashboard.py --project-id <uuid>
   ```

4. Open the printed URL and check the UI and any notebook runs as the intended viewer. API calls
   require the owner's Streamlit API-access opt-in and a signed-in viewer with direct project access.

Creating a Streamlit app restarts the project machine. By default the command waits up to 10 minutes
for `running`; use `--no-wait` to return after creation or lookup without checking readiness.
Re-publishing an existing entrypoint reports its app ID and URL without restarting the machine.
It waits for that app too; `unavailable` can be a temporary state during a restart.

Deleting the entrypoint can remove its app registration; some apps created in the UI retain it.
Sync overwrites changed files in place, so an edited entrypoint keeps its app and URL. Never
delete and re-upload an entrypoint to change it: that removes the app, and publishing again creates
a new one with a new URL.

### Handle failures

- **Entrypoint not found:** upload the file to the target project's Files, then retry. This command
  does not upload local files.
- **Startup timeout:** the app still exists. Inspect it in Deepnote, start the project machine if it
  is stopped, and rerun publish to check its status again.
- **Other request failures:** resolve the reported access, project, or network error before retrying.

## Options

`deepnote publish <dir>`:

| Option                | Use                                                             |
| --------------------- | --------------------------------------------------------------- |
| `--project-id <uuid>` | Target data app project; required unless `--create` is used     |
| `--create <name>`     | Create a data app project with this name and publish to it      |
| `--folder-id <uuid>`  | Folder for the project made by `--create`; default is the root  |
| `--path <prefix>`     | Target directory at or below `_deepnote_static`                 |
| `--prune`             | Delete remote files absent from the local build                 |
| `--sync-root <dir>`   | Use this sync workspace; default searches upward from the build |
| `--no-sync-root`      | Skip sync workspace discovery and updates                       |
| `--force`             | Overwrite changes not yet pulled into the sync workspace        |
| `--token <token>`     | API token; defaults to `DEEPNOTE_TOKEN`                         |
| `--url <url>`         | API origin; defaults to `https://api.deepnote.com`              |
| `-q, --quiet`         | Suppress progress and results; errors still go to stderr        |

`deepnote streamlit publish <entrypoint>`:

| Option                | Use                                                      |
| --------------------- | -------------------------------------------------------- |
| `--project-id <uuid>` | Required target project                                  |
| `--no-wait`           | Return without checking readiness                        |
| `--token <token>`     | API token; defaults to `DEEPNOTE_TOKEN`                  |
| `--url <url>`         | API origin; defaults to `https://api.deepnote.com`       |
| `-q, --quiet`         | Suppress progress and results; errors still go to stderr |

Streamlit publishing does not update app settings or a sync workspace.

## Unpublish a data app

```bash
deepnote unpublish --project-id <uuid>
```

The app becomes editor-only; its files stay in the project and `deepnote publish` publishes it again.
Authentication and the API origin match `publish`.

## Interpret the result

| Exit code | `deepnote publish`                                                                                                                                    | `deepnote streamlit publish`                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `0`       | Files uploaded and the app published                                                                                                                  | App running, or created/found with `--no-wait` |
| `1`       | Request, upload, prune, or publishing failure; or unsynced remote changes                                                                             | Request failure or startup timeout             |
| `2`       | Not a data app project, invalid arguments, missing token/directory, `.env` or over-100 MiB file in the directory, or unusable sync manifest/workspace | Invalid arguments or missing token             |

A failed app upload can leave partial changes; successful uploads are not rolled back. Fix the
reported failures and publish again. After an upload fails, the app keeps its previous publish state
and remaining stale files are not pruned; an app that was already published serves the partly updated
files, which can leave it unable to load. Replacement overwrites the remote file in place rather than
deleting it first, so the path is never empty, but a request that failed after the server committed
the replacement leaves the new version in place.

For `unpublish`, exit codes are `0` for success, `1` for a request failure (including a project that
is not a data app), and `2` for invalid arguments or a missing token.
