# @deepnote/cloud-mock

Simple mocks of the Deepnote Cloud API v2 endpoints for tests, served locally from a directory of
`.deepnote` files.

## Installation

```bash
npm install --save-dev @deepnote/cloud-mock
```

## Usage

```ts
import { syncWorkspace } from "@deepnote/cloud-sync";
import { startMockDeepnoteCloud } from "@deepnote/cloud-mock";

const cloud = await startMockDeepnoteCloud();
// Seed projects by writing files under cloud.rootDir.

await syncWorkspace({
  rootDir: "./deepnote-workspace",
  baseUrl: cloud.url,
  token: "any-token",
  onConflict: "skip",
});

await cloud.stop();
```

`startMockDeepnoteCloud(options?)` starts the mock on a free port of `127.0.0.1` and resolves to
`{ rootDir, url, stop }`. Any Bearer token is accepted. The options are:

- `rootDir`: the directory to serve. Defaults to a temp directory that `stop()` deletes.
- `onRequest({ method, url })`: awaited for every request with a Bearer token before it is routed.
- `onNotFound(req, res)`: answers requests to endpoints the mock does not serve. The package exports
  `sendJson`, `sendBytes`, `sendError`, `HttpError` and the API types (`components`, `operations`,
  `paths`) for writing them.

Each project is a directory named by its UUID:

```text
<rootDir>/
└── 2f7c1b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b/
    ├── .data-app       # only in a data app project
    ├── main.deepnote   # its notebooks
    └── .files/         # its working files
```

## Endpoints

- `GET /v2/me`
- `GET /v2/projects` and `POST /v2/projects`
- `GET /v2/projects/{projectId}` and `PATCH /v2/projects/{projectId}`
- `GET /v2/projects/{projectId}/export` and `POST /v2/projects/{projectId}/import`
- `GET /v2/files/download`, `POST /v2/files` and `DELETE /v2/files`
- `GET /v2/streamlit-apps`, `POST /v2/streamlit-apps` and `GET /v2/streamlit-apps/{streamlitAppId}/status`

Streamlit apps are kept in memory, not under `rootDir`, and report `running` as soon as they are created.

## Command line

```bash
npx @deepnote/cloud-mock [dir]
```

Serves `dir`, or a new temp directory, and prints the API base URL.

## API types

`src/deepnote-cloud-api.generated.d.ts` is generated from the public OpenAPI document:

```bash
pnpm --filter @deepnote/cloud-mock generate:api-types
```
