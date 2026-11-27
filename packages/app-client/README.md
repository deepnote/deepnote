# @deepnote/app-client

Browser client for Deepnote data app pages. It defines `window.Deepnote`, through which a page reads
its notebook's inputs, results and dataframes, and runs the notebook.

Data app pages load the client with:

```html
<script src="https://deepnote.com/static/app-client/v1.js"></script>
```

`@deepnote/app-client/v1` is the browser script that defines `window.Deepnote` (`dist/v1.iife.js`).
The client treats the origin it was loaded from as the shell's: it posts messages to the parent
window only at that origin, and accepts token replies and element-picking messages only from it.

The package's main entry provides the constants and types for servers and shells that talk to the
client. It ships ESM and CJS builds and imports no DOM code, so it loads in Node.

## Installation

```bash
npm install @deepnote/app-client
```

## Page API

```js
const client = Deepnote.connect();
const notebook = client.notebook();

const inputs = await notebook.inputs();
const { run, result } = await notebook.run({ region: "EU" });
const output = run.status === "success" ? result() : null;

const sales = await client.dataframe("sales", { pageSize: 50 });
```

| Call                               | Description                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Deepnote.connect(options?)`       | Returns a `DeepnoteClient`. `options.onAuthExpired: () => void` is called when the client cannot get an API token, after the Deepnote shell has not answered for 8 seconds. Calls after that reject until the page reloads.                                                                                                            |
| `client.notebook(notebookId?)`     | Returns a `DeepnoteNotebook`. Without `notebookId` it uses the data app's own notebook, the token reply's `notebookId`, and its methods reject when the reply has none.                                                                                                                                                                |
| `notebook.inputs()`                | Resolves the notebook's input blocks as `DeepnoteInput[]`, from `GET /v2/notebooks/{notebookId}`.                                                                                                                                                                                                                                      |
| `notebook.appData()`               | Resolves `DeepnoteAppData`, from `GET /v2/notebooks/{notebookId}/app-data`: the first JSON output and the agent block summary of the caller's newest successful detached run.                                                                                                                                                          |
| `notebook.run(inputs, options?)`   | Starts a run with `inputs` (`Record<string, DeepnoteInputValue>`) and `detachedRunStorageMode: 'readonly'`, polls it every 2 seconds, and resolves `DeepnoteRunResult` once it ends with `success`, `error`, `internal_error` or `stopped`; check `run.status`. Rejects when the run succeeds but Deepnote could not store its result. |
| `client.dataframe(name, options?)` | Resolves one page of the dataframe `name` as `DeepnoteDataframePage`, from `GET /v2/projects/{projectId}/dataframes/{name}`. `options` takes `pageIndex` and `pageSize`. Rejects when the token reply has no `projectId`.                                                                                                              |

`run` takes `options.onProgress(run, phase)`, called after each poll until the run ends, with `phase`
`'executing'` or `'storing-result'`, and `options.timeoutMs`, which defaults to 20 minutes. Past
`timeoutMs` the call rejects with `Run <runId> did not finish in time.` and the run is not stopped.

`result(schema?)` returns the first `application/json` output of the run, or the first whose
`schema` field equals `schema`, and `null` when there is none.

A non-2xx API response rejects the call with an `Error` whose message is the response's `message`,
or `Request failed with status <status>`.

## Node entry

A server that answers `POST /__deepnote/api-token` on a data app's origin types its reply:

```ts
import type { DeepnoteTokenReply } from "@deepnote/app-client";

const reply = {
  token,
  apiOrigin,
  expiresAtSeconds,
  projectId,
  notebookId: null,
} satisfies DeepnoteTokenReply;
```

| Export                                                                                                                              | Description                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATIC_FILES_API_TOKEN_PATH`                                                                                                       | `/__deepnote/api-token`, the token route the client POSTs on the page's origin.                                                                                        |
| `STATIC_FILES_API_TOKEN_EMBEDDED_HEADER`                                                                                            | The header the client sets to `1` on that request when the page's parent is not the top window.                                                                        |
| `STATIC_FILES_*_MESSAGE`                                                                                                            | The `type` of each message the client and the shell exchange.                                                                                                          |
| `STATIC_FILES_APP_MAX_ERRORS`, `STATIC_FILES_APP_MAX_ERROR_LENGTH`, `STATIC_FILES_APP_PREVIEW_WIDTH`                                | The number of distinct errors the client reports per page load, the length each is cut to, and the preview image width in pixels.                                      |
| `DeepnoteTokenReply`                                                                                                                | The 200 body of `POST /__deepnote/api-token`, and the shell's token reply without `type`.                                                                              |
| `DeepnoteClientMessage`                                                                                                             | The messages the client posts to the shell: `DeepnoteTokenRequestMessage`, `DeepnoteAppErrorMessage`, `DeepnoteAppReadyMessage` and `DeepnoteAppPickMessage`.          |
| `DeepnoteShellMessage`                                                                                                              | The messages the shell posts to the client: `DeepnoteTokenResponseMessage`, `DeepnotePreviewRequestMessage`, `DeepnotePickStartMessage` and `DeepnotePickStopMessage`. |
| `DeepnoteNotebookResponse`, `DeepnoteCreateRunRequest`, `DeepnoteCreateRunResponse`, `DeepnoteRunResponse`, `DeepnoteErrorResponse` | The bodies of the client's `/v2` requests and of their answers. The app-data and dataframe routes answer with `DeepnoteAppData` and `DeepnoteDataframePage`.           |

The page API's types are exported too: `DeepnoteClient`, `DeepnoteConnectOptions`,
`DeepnoteNotebook`, `DeepnoteInput`, `DeepnoteInputValue`, `DeepnoteRun`, `DeepnoteRunOptions`,
`DeepnoteRunResult`, `DeepnoteSnapshotBlock`, `DeepnoteAppData`, `DeepnoteDataframePage`,
`DeepnoteDataframeColumn` and `DeepnoteDataframePageOptions`.

## Contract

1. Every value the client reads from a server, the shell or the token route has an exported type.
2. A field that a producer must send is required in its type, with `null` meaning "none".
3. A change that breaks pages or producers written against `v1` ships as a new `vN` entry in a major
   release, and `v1` stays.

## License

Apache-2.0. `dist/v1.iife.js` bundles modern-screenshot 4.7.0 (MIT), whose license notice heads the
file.
