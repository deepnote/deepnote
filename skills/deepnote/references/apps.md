# Deepnote apps

Deepnote has several distinct app models. They differ in what the app is made of, where it runs, who
hosts it, and what credentials it gets. Choosing the wrong one usually shows up late — as a file an
agent cannot create, hardware that is not there, or an API call that silently does nothing once the
app is published.

Read this before choosing, building, previewing, publishing, or explaining a Deepnote app.

## Decision table

| Need                                                 | Model                                 | Hosting                     | Viewer-scoped API access               | Project hardware    | Can an agent create the files?          |
| ---------------------------------------------------- | ------------------------------------- | --------------------------- | -------------------------------------- | ------------------- | --------------------------------------- |
| Present notebook blocks with inputs and outputs      | Data app (notebook app)               | Deepnote                    | Not applicable (app runs the notebook) | Yes                 | No — created in the Deepnote UI         |
| Python UI framework, custom widgets                  | Streamlit app                         | Deepnote (project hardware) | Not applicable (server-side Python)    | Yes                 | Yes — it is a `.py` file in the project |
| Custom HTML/JS, no Deepnote calls                    | Published static site                 | Deepnote (browser only)     | No                                     | No                  | Yes — plain files + `deepnote publish`  |
| Custom HTML/JS that starts and reads notebook runs   | Published browser app with API access | Deepnote (browser only)     | Yes, viewer-scoped, run loop only      | Yes, for the run    | Yes — same, plus `--api-access enabled` |
| Custom UI plus local Python, scheduling, run history | Local Node app (`serveStatic`)        | Local machine               | No — it uses the operator's own token  | Only for cloud runs | Yes — static dir + a `serve.mjs`        |

## 1. Data apps (notebook apps)

Built from notebook blocks through Deepnote's app UI: choose which blocks appear, whether a block
shows code, output, or both, then set app permissions independently of the project's. Viewers change
input blocks and re-run; runs are stateless per viewer and execute on the project's hardware.

This is the right model when the deliverable is the notebook itself. It is not deprecated, and it is
not a fallback for the other models — use the product terms "data app" or "notebook app".

An agent cannot create one from files: app creation and its settings live in the Deepnote product.
An agent's contribution is the notebook — blocks, inputs, layout-friendly ordering. See
`docs/data-apps.md` for the product behavior.

## 2. Streamlit apps

A `.py` entrypoint in the project, served on the **project's hardware**. Deepnote detects a Streamlit
file and deploys it; the app inherits the project's environment, integrations, and sharing settings,
and sleeps when the hardware is inactive.

An agent working on local files can write and edit that `.py` file like any other source file. What
it cannot do is create the file remotely: hosted MCP can activate an existing entrypoint in a
project, but it cannot upload or author the `.py` file itself. Do not plan a workflow that assumes an
agent can stand up a complete Streamlit app in a hosted project from scratch.

Streamlit apps run server-side Python, so they use ordinary integration access, not a viewer token.
Federated-auth integrations are the exception — each viewer authenticates individually
(`docs/streamlit.md`).

## 3. Published static sites

Browser files — HTML, JS, CSS, assets — stored below `_deepnote_static/**` in the project's file
store and served by Deepnote. There is no server: whatever the browser can do, the app can do.

```bash
deepnote publish ./dist --project-id <uuid>
```

`deepnote publish` deploys into `_deepnote_static/**`: it replaces matching files, optionally prunes
stale ones, enables website sharing, and prints the canonical URL. Use that returned URL — never
assemble a static-site URL by hand.

The site serves like a regular web server: the site URL's root serves `index.html`, a path ending in
`/` serves that directory's `index.html`, and every other file is served at its own path
(`about.html` → `<site URL>/about.html`; `/about` is not rewritten to it).

Publishing and access are separate operations. To stop serving a site without deleting its files,
run `deepnote static-site access --project-id <uuid> --sharing disabled`. Re-enable it later with
`--sharing enabled`; use `--api-access enabled|disabled` to change viewer API access without
republishing. Disabling sharing also disables viewer API access.

Ownership note: the static root is a subtree of the same project file store that
`deepnote sync --all-files` mirrors, so both commands write those paths. They share one baseline
rather than splitting the namespace, and `publish` is the deploying writer — build output goes
through `publish`, not through a synced workspace. Two consequences for anyone scripting a deploy:

- Publish looks upwards from the published directory for a sync workspace and updates its mirror, so
  the next sync sees the deploy as already in step. A CI deploy has no workspace to update and
  should pass `--no-sync-root`.
- If a path publish is about to write or prune has moved on in Deepnote since that workspace last
  synced, it exits 1 without touching the project. Sync first, or pass `--force`. A sibling under
  the target that is not in this build (and not being pruned) does not stop the deploy.

`references/cli-publish.md` (options, exit codes, the full coordination rules) and
`references/cli-sync.md` carry the rest.

## 4. Published browser apps with API access

A published static site with **API access for static apps** enabled — a separate opt-in from website
sharing:

```bash
deepnote publish ./dist --project-id <uuid> --api-access enabled
```

The embedded page never carries a personal token. The Deepnote shell hands it a short-lived,
project- and viewer-scoped token over `postMessage`, together with the API origin to send it to; the
app must pin the shell origin in both directions of that handshake. A personal token used during
local development stays local and is never embedded in the published site.

The viewer token is limited to one run loop:

| Allowed                                                                          | Not allowed                    |
| -------------------------------------------------------------------------------- | ------------------------------ |
| Read the configured notebook's inputs and block metadata, without source content | Enumerate notebooks            |
| Start a detached run                                                             | Enumerate run history          |
| Poll that viewer's own run by id                                                 | Call arbitrary `/v2` endpoints |
| Receive sanitized output blocks (`snapshotBlocks`) instead of raw snapshot YAML  | Read another viewer's run      |

The consequence is a quiet failure mode: code developed against a local preview with a personal
token keeps working there and does nothing once embedded, with no error. Guard those paths on an
`isEmbedded` check rather than letting them fail silently — `examples/local-runner/cloud-app`
does exactly this for its run-history panel, and is the reference implementation for the handshake.

## 5. Local Node-backed apps (`serveStatic`)

`serveStatic` from `@deepnote/local-runner` is a **local server runtime**, not a published site. It
serves a static directory from `127.0.0.1` and adds a small API in front of a `.deepnote` file. This
is the model for a local dashboard or a demo on the operator's machine; publishing its directory to
Deepnote gives you model 3 or 4 instead, with none of these routes.

```ts
const { port, close } = await serveStatic({
  dir,
  notebookPath,
  runTarget: "cloud",
});
```

| Route                         | Request                                                             | Response                                                                                      |
| ----------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/info`               | —                                                                   | `{ notebook, inputs, runTarget }` — input blocks for building controls, plus where runs go    |
| `POST /api/run`               | `{ inputs }`                                                        | `{ target, success, outputs, summary, snapshotYaml, runId?, viewUrl?, created? }`             |
| `POST /api/schedule-cloud`    | `{ schedule: { frequency, time, … }, timezone? }` or raw `{ cron }` | the created or updated cloud schedule; does not run the notebook now                          |
| `GET /api/cloud-runs`         | —                                                                   | `{ runs, viewUrl }`; `{ runs: [] }` when there is no token or the notebook is not in Deepnote |
| `GET /api/cloud-runs/{runId}` | —                                                                   | `{ runId, status, success, outputs, snapshotYaml }` for one past run, without re-running it   |

Any other `GET` serves a file from the directory, path-traversal and symlink guarded.

**Run target.** One endpoint, one button, wherever the run happens. `runTarget` defaults to `cloud`
— `POST /api/run` goes to Deepnote (needs `DEEPNOTE_TOKEN`) and creates the notebook there if it
does not exist yet. `runTarget: 'local'` runs in a local Python kernel instead, which needs
`deepnote-toolkit[server]`, and writes a snapshot next to the notebook like `deepnote run`. A local
run reports no `runId`/`viewUrl`, and the cloud-run routes answer empty.

**Rendering stays in the page.** To display outputs, use the `snapshot-reader.js` browser bundle
(`@deepnote/local-runner/snapshot-reader`) to parse snapshot YAML client-side. Embedded published
apps (model 4) do not need it for run results — those arrive pre-parsed as `snapshotBlocks`.

See `packages/local-runner/README.md` and `examples/local-runner/run-app` for the full package
surface.

## MCP surfaces are not interchangeable

Three separate things, often confused:

- **`@deepnote/mcp`** — the local-file MCP server shipped from this repository. It reads, writes,
  converts, and runs `.deepnote` files on the local filesystem. It knows nothing about hosted
  projects, publishing, or apps.
- **Hosted MCP at `https://deepnote.com/mcp`** — operates on hosted workspace state (projects,
  notebooks, blocks, runs, integrations) under the authenticating identity's permissions. See
  `docs/deepnote-mcp.md`; the authoritative tool list is the server's own `tools/list`, so do not
  assume a fixed set or count.
- **Codex-plugin documentation and skills** — a _consumer_ of the hosted MCP, not a third MCP
  implementation.

For static sites, use `deepnote publish` when a local terminal is available. When only the hosted MCP
can deploy, use its narrow `publish_static_site` tool if the connected server advertises it; then use
`update_project` to disable or re-enable sharing, or to change viewer API access, without changing
the published files. Do not fall back to notebook execution as a way to write website files. Hosted
MCP still cannot upload a Streamlit entrypoint.
