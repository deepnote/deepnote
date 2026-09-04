---
title: Publishing static sites with the Deepnote CLI
description: Deploy a local build directory to a Deepnote project as a hosted static website using deepnote publish
noIndex: false
noContent: false
---

`deepnote publish` uploads a local directory — a Vite or Next.js build, a hand-written page, a
documentation site — to an existing Deepnote project and serves it as a static website. The command
uploads the files, enables static website sharing, and prints the canonical URL Deepnote assigns.

```bash
deepnote publish ./dist --project-id <project-id>
```

This is a command-line deploy path, separate from publishing an app from inside the Deepnote editor.
It writes plain files; it does not create or run notebooks.

<Callout status="warning">
A published static site is **not anonymously public**. Viewers must be signed in to Deepnote and have
access to the project. See [Who can view a published site](#who-can-view-a-published-site) — the
access model differs from [data apps](/docs/data-apps), which do offer public and link-only sharing.
</Callout>

## Prerequisites

- **An existing Deepnote project.** `deepnote publish` never creates one. Create the project in
  Deepnote first and copy its ID.
- **The Deepnote CLI.** Install it with `npm install -g @deepnote/cli` (or run it through
  `npx @deepnote/cli`).
- **An API token** with access to that project.

## Authentication

The CLI reads your token from the `DEEPNOTE_TOKEN` environment variable, or from an explicit
`--token` flag. Create a token in your workspace under
[Settings & members → API tokens](https://deepnote.com/workspace/settings/api-tokens).

```bash
export DEEPNOTE_TOKEN="<your-token>"
deepnote publish ./dist --project-id <project-id>
```

Without a token the command exits with code `2` and prints where to get one.

### Token safety

<Callout status="warning">
An API token carries your access to the workspace. Treat it like a password.
</Callout>

- **Prefer the environment variable.** A token passed as `--token` is visible in your shell history
  and in the process list of a shared machine. `DEEPNOTE_TOKEN` avoids both.
- **In CI, use a secret.** Store the token in your CI provider's secret store and expose it as
  `DEEPNOTE_TOKEN` for the publish step only. Never commit it to the repository you are deploying.
- **Rotate and revoke** from the same settings page if a token is ever exposed.
- **Keep it out of the build directory.** Everything under the directory you publish becomes readable
  at the site URL by anyone who can view the site — including dotfiles, source maps, and stray `.env`
  files. Publish a clean build output directory, not a project root.

## Finding a project ID

Open the project in Deepnote and read the `project_id` — a UUID — from the URL. The general structure
when editing a notebook is:

```
https://deepnote.com/workspace/<workspace_name>-<workspace_id>/project/<project_name>-<project_id>/notebook/<notebook_name>-<notebook_id>
```

That `project_id` is the value for `--project-id`. Inside a running notebook it is also available as
the `DEEPNOTE_PROJECT_ID` environment variable, which is handy if you script the deploy from the
project itself.

## Where the files go

Published files live under a reserved directory in the project's file store called
`_deepnote_static`. Publishing `./dist/index.html` puts the file at `_deepnote_static/index.html`,
and that path is what the site serves.

Use `--path` to publish below a subdirectory of the static root — useful for keeping versions side by
side:

```bash
deepnote publish ./dist --project-id <project-id> --path _deepnote_static/v2
```

`--path` must be `_deepnote_static` or a directory under it; anything else is rejected before the
command touches the project. Nested path segments are percent-encoded in the printed URL, so a path
containing `#` or `?` still yields a working link.

Always use the URL the command prints rather than assembling one yourself. Deepnote serves each
project's site from its own dedicated origin and hands out the shareable link on the main domain, so
a hand-built URL is unlikely to resolve.

## Who can view a published site

Static site sharing is **not** public hosting. Every viewer must be:

1. **Signed in to Deepnote** — anonymous visitors are redirected to sign-in, never served content.
2. **An active user** — suspended or deactivated accounts are refused.
3. **Able to view the project** — workspace members, project collaborators (including app users),
   and user groups with project access.

Two further switches can turn a site off independently of the project setting: a workspace-level
static file sharing setting, and plan availability for the feature. Access is re-checked on every
request, so revoking any of these — the project toggle, the workspace setting, the viewer's account,
or the plan — takes effect immediately rather than at the next deploy.

<Callout status="warning">
There is no anonymous tier and no link-only tier for static sites. A link alone never grants access,
so you cannot use `deepnote publish` to serve a page to the general public, to an unauthenticated
webhook consumer, or to a search engine crawler.
</Callout>

This is the main difference from [data apps](/docs/data-apps), which do offer **Anyone with a link**
and **Public** access levels. If your deliverable has to reach people without Deepnote accounts, a
data app is the model that supports it — not a published static site.

## Options

| Option                           | Description                                                              | Default                     |
| -------------------------------- | ------------------------------------------------------------------------ | --------------------------- |
| `--project-id <id>`              | Project to publish to (required)                                         |                             |
| `--path <prefix>`                | Target directory at or below `_deepnote_static`                          | `_deepnote_static`          |
| `--api-access enabled\|disabled` | Explicitly enable or disable Deepnote API access for the site            | unchanged                   |
| `--prune`                        | Delete remote files below `--path` that are absent from the local build  | `false`                     |
| `--sync-root <dir>`              | Sync workspace whose local mirror to update                              | search upwards from `<dir>` |
| `--no-sync-root`                 | Publish without looking for or updating a sync workspace                 | `false`                     |
| `--force`                        | Publish even when Deepnote holds changes a sync workspace has not pulled | `false`                     |
| `--token <token>`                | API token                                                                | `DEEPNOTE_TOKEN`            |
| `--url <url>`                    | API base URL (for single-tenant instances)                               | `https://api.deepnote.com`  |
| `-q, --quiet`                    | Suppress progress output; errors still print to stderr                   | `false`                     |

## API access for published sites

By default a published site is a plain static website: it can serve HTML, CSS, JavaScript, and
assets, but it cannot call the Deepnote API.

Passing `--api-access enabled` lets the page acquire a short-lived, project- and viewer-scoped token
from the Deepnote shell that embeds it. That token has a deliberately narrow surface — read the
configured notebook, start a run, poll that run — which is what makes an interactive page possible
without a server of your own.

This is a second opt-in layered on top of site sharing, and it can only ever narrow the audience, not
widen it: a viewer who cannot see the site cannot obtain a token for it. Because every viewer is a
signed-in user with project access, the token is minted for that identity.

<Callout status="warning">
API access is security-sensitive and is never enabled implicitly. Enable it only when the page needs
to load notebooks or start runs, and remember that anyone who can view the site can exercise that
access.
</Callout>

Omitting the flag leaves the project's current setting untouched, so a routine redeploy cannot
silently turn API access on or off. Pass `--api-access disabled` to turn it off explicitly.

## Removing files from an earlier build

By default publish replaces the files present in your local directory and leaves everything else
alone, so assets from an older build accumulate. `--prune` deletes remote files below `--path` that
are absent locally:

```bash
deepnote publish ./dist --project-id <project-id> --prune
```

Pruning is ordered so a failed deploy cannot leave the site half-deleted. Stale paths that block a
directory the new build needs are removed first, because the upload cannot proceed without them.
Every other stale file is removed only after all uploads have succeeded.

<Callout status="info">
`deepnote publish --prune` deletes **remote** files that are missing locally. The unrelated
[`deepnote sync --prune`](/docs/deepnote-cli-sync) deletes **local** files that are missing in the
cloud. The two flags share a name and point in opposite directions.
</Callout>

## Failure behavior

The command validates everything it can locally before touching the project, then makes remote
changes in a fixed order.

- **Local path problems abort before any upload.** A filename with a leading or trailing space, a
  backslash, or two local files that would collide at the same remote path all stop the command with
  exit code `2` and an unchanged project.
- **Each file is read before its remote copy is replaced**, so an unreadable local file leaves the
  live version intact.
- **Website sharing is enabled only after every upload succeeds.** A partial upload is reported as a
  failure and does not flip the sharing setting or prune remaining stale files.
- **A failed file is reported individually** and the command continues with the rest, then exits
  with code `1`. Successful uploads are not rolled back — re-run the command once the cause is fixed.

### Exit codes

| Code | Meaning                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------- |
| `0`  | Files uploaded and website sharing enabled                                                               |
| `1`  | A project lookup, upload, prune, or settings update failed, or Deepnote holds changes not pulled locally |
| `2`  | Invalid usage — bad `--path`, missing directory, missing token, or an unusable `--sync-root`             |

<Callout status="info">
Each file is replaced with a delete followed by an upload, so a file being overwritten is briefly
unavailable on the live site. Publish during a quiet window if that matters for your deployment.
</Callout>

## Working alongside `deepnote sync`

`_deepnote_static` is part of the same project file store that
[`deepnote sync --all-files`](/docs/deepnote-cli-sync) mirrors, so both commands can write those
paths. They coordinate rather than divide the namespace:

- **`deepnote publish` is the write path for the static root.** It is the command that deploys a
  build, and in practice the only one that should be authoring those files.
- **`deepnote sync` mirrors them but never silently overwrites them.** Before pushing any working
  file it checks the current state in Deepnote, and a file that changed since it last synced is
  surfaced as a conflict to resolve rather than overwritten.
- **When you publish from inside a synced workspace**, publish also updates that workspace's local
  mirror and its `.deepnote-sync.json`, so the next sync sees the deploy as already up to date
  instead of re-downloading the whole site.
- **If Deepnote holds changes your workspace has not pulled**, publish stops before writing anything
  rather than destroying content you have no local copy of. Run `deepnote sync --all-files` to bring
  it down, or pass `--force` to overwrite.

Use `--no-sync-root` for a CI deploy, where there is no workspace to keep in step and the extra
lookup is pointless.

## Related

- [Syncing a workspace with the Deepnote CLI](/docs/deepnote-cli-sync) — mirror projects to a local
  directory and push notebook edits back
- [Deepnote file sync](/docs/deepnote-file-sync) — the in-product feature that keeps a project synced
  with a `.deepnote` file in a Git repository
- [Data apps](/docs/data-apps) — building interactive apps on Deepnote
