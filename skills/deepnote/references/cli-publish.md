# Publish apps and Streamlit apps

Two commands publish to an existing Deepnote project. Choose the command from the source:

- **App:** a local directory of HTML, CSS, JavaScript, and assets, uploaded for Deepnote to host:
  `deepnote publish <dir> --project-id <uuid>`.
- **Streamlit app:** a project-relative `.py` entrypoint in the project's Files, optionally uploaded
  from the current directory first:
  `deepnote streamlit publish <entrypoint> --project-id <uuid> [--upload]`.

If the workflow is undecided, start with [Build and publish apps and Streamlit apps](apps.md).

## Before publishing

1. Confirm the target project ID and the files to publish. Neither command creates projects.
2. Set `DEEPNOTE_TOKEN` in the environment or in a `.env` file in the current directory, or pass
   `--token`. Use `--url` only to override the default API origin, `https://api.deepnote.com`.
   Keep the token out of app files.
3. For an app, build into a dedicated directory and inspect its contents. Everything in that
   directory will be uploaded, including dotfiles; `publish` refuses a directory containing a `.env`
   or `.env.*` file at any depth, or a file over 100 MiB (exit code 2).
4. For a new Streamlit app, account for the project-machine restart and interruption to active work.

## Publish an app

```bash
deepnote publish ./dist --project-id <uuid>
```

Matching files under `_deepnote_static` are replaced. Files absent from the local build are retained,
and sharing is enabled after uploads succeed. Use the returned URL and verify the hosted app's
assets and navigation.

Add only the options the deployment needs:

```bash
# Allow the app to use the viewer's notebook API access
deepnote publish ./dist --project-id <uuid> --api-access enabled

# Remove remote files left over from earlier builds
deepnote publish ./dist --project-id <uuid> --prune

# Keep a version under a separate path
deepnote publish ./dist --project-id <uuid> --path _deepnote_static/v2

# Publish from CI without a local sync workspace
deepnote publish ./dist --project-id <uuid> --no-sync-root
```

Omitting `--api-access` preserves its current setting. Before enabling it, implement and verify
[viewer API access](apps.md#add-viewer-api-access), including token refresh. A personal token in a
local preview has broader permissions than a hosted viewer token.

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

1. Put the entrypoint's local dependencies in the project's Files: upload them in Deepnote, or push
   them with `deepnote sync --all-files` alongside a notebook push. Sync does not push a `.py`-only
   edit alone. Upload the entrypoint itself in Deepnote, or with `--upload` in step 3.
2. If the app runs a notebook, deploy it with the matching block IDs before publishing. See
   [Prepare a Streamlit app](apps.md#prepare-a-streamlit-app).
3. Publish using the project-relative path. Add `--upload` to upload the entrypoint from the
   current directory first:

   ```bash
   deepnote streamlit publish apps/dashboard.py --project-id <uuid>
   deepnote streamlit publish apps/dashboard.py --project-id <uuid> --upload
   ```

4. Open the printed URL and check the UI and any notebook runs as the intended viewer. API calls
   require the owner's Streamlit API-access opt-in and a signed-in viewer with direct project access.

Creating a Streamlit app restarts the project machine. By default the command waits up to 10 minutes
for `running`; use `--no-wait` to return after creation or lookup without checking readiness.
Re-publishing an existing entrypoint reports its app ID and URL without restarting the machine.
It waits for that app too; `unavailable` can be a temporary state during a restart.

`--upload` reads the entrypoint relative to the current directory (in a sync workspace, the
project's `.files` folder) and uploads only that file; its dependencies must already be in the
project's Files. When a sync workspace at or above that file tracks the project, the upload is
recorded in `.deepnote-sync.json`. A file changed in Deepnote since the last sync is not
overwritten: run `deepnote sync --all-files` first, which replaces the local file with the Deepnote
copy, or pass `--force`.

Deleting the entrypoint can remove its app registration; some apps created in the UI retain it.
`--upload` replaces the file in place and keeps the app. Sync replaces changed files by deleting and
uploading them. After syncing an edited entrypoint, publish again and use the returned URL, which
may change.

### Handle failures

- **Entrypoint not found:** upload the file in Deepnote, or run the command again with `--upload`.
- **File changed in Deepnote (exit code 1):** run `deepnote sync --all-files`, or pass `--force` to
  overwrite the Deepnote copy.
- **Startup timeout:** the app still exists. Inspect it in Deepnote, start the project machine if it
  is stopped, and rerun publish to check its status again.
- **Other request failures:** resolve the reported access, project, or network error before retrying.

## Options

`deepnote publish <dir>`:

| Option                           | Use                                                             |
| -------------------------------- | --------------------------------------------------------------- |
| `--project-id <uuid>`            | Required target project                                         |
| `--path <prefix>`                | Target directory at or below `_deepnote_static`                 |
| `--api-access enabled\|disabled` | Change viewer API access; omitted preserves it                  |
| `--prune`                        | Delete remote files absent from the local build                 |
| `--sync-root <dir>`              | Use this sync workspace; default searches upward from the build |
| `--no-sync-root`                 | Skip sync workspace discovery and updates                       |
| `--force`                        | Overwrite changes not yet pulled into the sync workspace        |
| `--token <token>`                | API token; defaults to `DEEPNOTE_TOKEN`                         |
| `--url <url>`                    | API origin; defaults to `https://api.deepnote.com`              |
| `-q, --quiet`                    | Suppress progress and results; errors still go to stderr        |

`deepnote streamlit publish <entrypoint>`:

| Option                | Use                                                      |
| --------------------- | -------------------------------------------------------- |
| `--project-id <uuid>` | Required target project                                  |
| `--upload`            | Upload the entrypoint from the current directory first   |
| `--force`             | With `--upload`, overwrite a file changed in Deepnote    |
| `--no-wait`           | Return without checking readiness                        |
| `--token <token>`     | API token; defaults to `DEEPNOTE_TOKEN`                  |
| `--url <url>`         | API origin; defaults to `https://api.deepnote.com`       |
| `-q, --quiet`         | Suppress progress and results; errors still go to stderr |

Streamlit publishing does not update app settings. With `--upload`, it updates the sync workspace that
tracks the project.

## Change app access

Use `deepnote static-site access` to change sharing or viewer API access without changing files:

```bash
# Stop serving the app but keep its files
deepnote static-site access --project-id <uuid> --sharing disabled

# Serve the stored app and enable viewer API access
deepnote static-site access --project-id <uuid> --sharing enabled --api-access enabled

# Revoke API access while keeping the current sharing setting
deepnote static-site access --project-id <uuid> --api-access disabled
```

Specify at least one setting. Disabling sharing also disables viewer API access. Re-enabling sharing
serves the retained files at the returned URL. Authentication and the API origin match `publish`.

## Interpret the result

| Exit code | `deepnote publish`                                                                                                            | `deepnote streamlit publish`                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `0`       | Files uploaded and sharing enabled                                                                                            | App running, or created/found with `--no-wait`                                                                                   |
| `1`       | Request, upload, prune, or settings failure; or unsynced remote changes                                                       | Request or upload failure, file changed in Deepnote, or startup timeout                                                          |
| `2`       | Invalid arguments, missing token/directory, `.env` or over-100 MiB file in the directory, or unusable sync manifest/workspace | Invalid arguments or missing token, `--force` without `--upload`, missing or over-100 MiB local file, or unusable sync workspace |

A failed app upload can leave partial changes; successful uploads are not rolled back. Fix the
reported failures and publish again. Sharing is not changed and remaining stale files are not
pruned after an upload fails.

For `static-site access`, exit codes are `0` for success, `1` for a request failure, and `2` for
invalid arguments, a missing token, or missing/contradictory settings.
