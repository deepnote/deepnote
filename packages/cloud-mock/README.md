# @deepnote/cloud-mock

Local mock of the Deepnote Cloud Public API v2 for testing sync clients. It serves the routes that
`deepnote sync` and the API token check call, from a directory of `.deepnote` files on disk.

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

### `startMockDeepnoteCloud(options?)`

Starts the server on a free port of `127.0.0.1`.

| Option      | Description                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`   | The directory to serve. It is resolved, created if missing, and kept by `stop()`. Without it, the mock creates a temp directory and `stop()` deletes it.                                                                        |
| `onRequest` | `({ method, url }) => void \| Promise<void>`. Called and awaited for every request with a token, before the request is routed. A throw answers the request with a 500. A hook that never settles keeps `stop()` from resolving. |

It resolves to an object with:

| Property  | Description                                                                             |
| --------- | --------------------------------------------------------------------------------------- |
| `rootDir` | The absolute path of the served directory.                                              |
| `url`     | The API base URL, `http://127.0.0.1:<port>`.                                            |
| `stop()`  | Waits for open requests, closes the server, then deletes `rootDir` if the mock made it. |

`MOCK_WORKSPACE_NAME` (`'Mock Workspace'`) is the workspace name `GET /v2/me` returns.

## On-disk layout

```text
<rootDir>/
└── 2f7c1b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b/   # a project: a directory named by its UUID
    ├── main.deepnote                       # its notebooks: the top-level *.deepnote files
    └── .files/                             # its working files
        └── data.csv
```

- A project is a direct subdirectory of `rootDir` whose name is a UUID. Other directories are
  ignored.
- The project's notebooks are its top-level `*.deepnote` files, in filename order
  (`localeCompare`). Each one is a document with one notebook, as `GET /v2/projects/{id}/export`
  returns them.
- The project's name is the first notebook's `project.name`, or its id when it has no notebooks.
- The project's working files are everything under `.files/`.

Editing these files changes the project "in Deepnote". A test can do that between requests, or
during one from `onRequest`.

## Routes

| Route                                  | Behavior                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/me`                           | A fixed workspace named `MOCK_WORKSPACE_NAME`.                                                                                          |
| `GET /v2/projects`                     | Every project, in a single page.                                                                                                        |
| `GET /v2/projects/{projectId}`         | The project, with the recursive inventory of `.files/` as `files`.                                                                      |
| `GET /v2/projects/{projectId}/export`  | A ZIP of the notebook files.                                                                                                            |
| `POST /v2/projects/{projectId}/import` | Writes the ZIP's documents over the notebook files. Supports `baseModifiedAt`, `baseContentHash`, `force` and `deleteMissingNotebooks`. |
| `GET /v2/files/download`               | The bytes of `.files/<path>`.                                                                                                           |
| `POST /v2/files`                       | A multipart upload to `.files/<path>`, with `overwrite`.                                                                                |
| `DELETE /v2/files`                     | Deletes `.files/<path>`.                                                                                                                |

An import is validated as the
[project import contract](https://github.com/deepnote/deepnote/blob/main/packages/cloud/docs/project-import-contract.md)
describes. It answers 422 for an archive that breaks the document rules and 409 when
`baseModifiedAt` or `baseContentHash` does not match the project, unless `force=true`. A request
without an `Authorization: Bearer …` header gets a 401, an unknown project a 404, and an unknown
route a 404.

## Command line

```bash
npx @deepnote/cloud-mock [dir]
```

Serves `dir`, or a new temp directory that it leaves in place, until it is killed. It prints the
directory and the API base URL:

```text
Serving the Deepnote projects in /tmp/projects
API base URL: http://127.0.0.1:40123
```

## Differences from Deepnote Cloud

- Every Bearer token is accepted.
- A notebook's identity is its filename, not the notebook id inside the document.
- An import does not change `metadata.modifiedAt`.
- A project with no notebooks, or whose first notebook has no `metadata.modifiedAt`, reports the
  `modifiedAt` `1970-01-01T00:00:00.000Z`.
- `GET /v2/projects` returns a single page, and every project has `folder: null`.
- `POST /v2/files` accepts multipart uploads only.
- An upload to an existing path without `overwrite` is stored as `<stem> (<n>)<ext>`, a format of
  the mock's own.
- Responses carry no `Content-Disposition` or `X-Content-Type-Options` header.
- `notebooks` and `integrations` are always `[]` in `GET /v2/projects` and
  `GET /v2/projects/{projectId}`.
- Documents are read with the bundled `@deepnote/blocks` schema. Importing a document it rejects,
  such as one with a newer block type, gets a 422, and a project whose first notebook it rejects
  makes `GET /v2/projects` answer 500.

## Regenerating the API types

The response bodies are typed by `src/deepnote-cloud-api.generated.d.ts`, generated from the public
OpenAPI document. Regenerate it, and do not edit it by hand:

```bash
pnpm --filter @deepnote/cloud-mock generate:api-types
```
