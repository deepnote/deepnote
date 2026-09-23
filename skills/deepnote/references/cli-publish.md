# Publish an app

Use `deepnote publish <path> --project-id <uuid>` to publish to an existing Deepnote project.
Choose the mode from the source:

- **Static app:** a local directory of browser files, uploaded by the command.
- **Streamlit app:** a project-relative `.py` entrypoint already in the project's Files; add
  `--streamlit`.

If the app type is undecided, start with [Build and publish a Deepnote app](apps.md).

## Before publishing

1. Confirm the target project ID and the files to publish. The command does not create projects.
2. Set `DEEPNOTE_TOKEN` or pass `--token`. Use `--url` only to override the default API origin,
   `https://api.deepnote.com`. Keep the token out of app files.
3. For a static app, build into a dedicated directory and inspect its contents. Everything in that
   directory will be uploaded, including dotfiles.
4. For a new Streamlit app, account for the project-machine restart and interruption to active work.

## Publish a static app

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

1. Upload the entrypoint and its local dependencies to the project's Files in Deepnote. If a
   notebook push is already pending in a sync workspace, use `deepnote sync --all-files` to include
   the working files. For a `.py`-only edit, upload in Deepnote; sync does not push that edit alone.
2. If the app runs a notebook, deploy it with the matching block IDs before publishing. See
   [Prepare a Streamlit app](apps.md#prepare-a-streamlit-app).
3. Publish using the project-relative path:

   ```bash
   deepnote publish apps/dashboard.py --project-id <uuid> --streamlit
   ```

4. Open the printed URL and check the UI and any notebook runs as the intended viewer. API calls
   require the owner's Streamlit API-access opt-in and a signed-in viewer with direct project access.

Creating an app restarts the project machine. By default the command waits up to 10 minutes for
`running`; use `--no-wait` to return after the app is created or found without checking readiness.
Re-publishing an existing entrypoint reports its app ID and URL without restarting the machine.
It waits for that app too; `unavailable` can be a temporary state during a restart.

Deleting the entrypoint can remove its app registration; some apps created in the UI retain it.
Sync replaces changed files by deleting and uploading them. After syncing an edited entrypoint,
publish again and use the returned URL, which may change.

### Handle failures

- **Entrypoint not found:** upload the file to the target project's Files, then retry. This command
  does not upload local files.
- **Startup timeout:** the app still exists. Inspect it in Deepnote, start the project machine if it
  is stopped, and rerun publish to check its status again.
- **Other request failures:** resolve the reported access, project, or network error before retrying.

## Options

| Option                           | Use                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `--project-id <uuid>`            | Required target project                                                           |
| `--streamlit`                    | Publish an existing project entrypoint as a Streamlit app                         |
| `--no-wait`                      | Streamlit apps only: return without checking readiness                            |
| `--path <prefix>`                | Static apps only: target directory at or below `_deepnote_static`                 |
| `--api-access enabled\|disabled` | Static apps only: change viewer API access; omitted preserves it                  |
| `--prune`                        | Static apps only: delete remote files absent from the local build                 |
| `--sync-root <dir>`              | Static apps only: use this sync workspace; default searches upward from the build |
| `--no-sync-root`                 | Static apps only: skip sync workspace discovery and updates                       |
| `--force`                        | Static apps only: overwrite changes not yet pulled into the sync workspace        |
| `--token <token>`                | API token; defaults to `DEEPNOTE_TOKEN`                                           |
| `--url <url>`                    | API origin; defaults to `https://api.deepnote.com`                                |
| `-q, --quiet`                    | Suppress progress and results; errors still go to stderr                          |

Options for one app type are rejected with the other. Streamlit publishing does not update static
app settings or a sync workspace.

## Change static app access

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

| Exit code | Static app                                                                      | Streamlit app                                             |
| --------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `0`       | Files uploaded and sharing enabled                                              | App running, or created/found with `--no-wait`            |
| `1`       | Request, upload, prune, or settings failure; or unsynced remote changes         | Request failure or startup timeout                        |
| `2`       | Invalid arguments, missing token/directory, or unusable sync manifest/workspace | Invalid arguments, missing token, or incompatible options |

A failed static upload can leave partial changes; successful uploads are not rolled back. Fix the
reported failures and publish again. Sharing is not changed and remaining stale files are not
pruned after an upload fails.

For `static-site access`, exit codes are `0` for success, `1` for a request failure, and `2` for
invalid arguments, a missing token, or missing/contradictory settings.
