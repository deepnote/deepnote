---
title: Interactive sessions with the Deepnote API
description: Keep a notebook's kernel alive between API calls, submit follow-up runs and code against the same state, and stop the session when you are done
noIndex: false
noContent: false
---

A [run](/docs/deepnote-api-runs) starts fresh and ends when the notebook finishes. An interactive
session keeps going: it runs the notebook once, then keeps the kernel (the loaded data, trained
models and every variable) so you can send more work to it. Each request skips the expensive setup
and builds on what is already in memory.

Sessions suit:

- **AI agents** that explore data step by step: load once, then ask follow-up questions as code.
- **Interactive tools** in your own product, where every click asks a question of the same loaded
  data.
- **Iterating on part of a notebook:** re-run the last few blocks with new inputs without
  repeating an hour-long load.

All examples use `$DEEPNOTE_TOKEN`; see [Authentication](/docs/deepnote-api#authentication).

## Start a session

```bash
curl -s -X POST https://api.deepnote.com/v2/sessions \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notebookId": "'"$NOTEBOOK_ID"'",
    "inputs": { "region": "EU" },
    "idleShutdownSeconds": 1800
  }'
```

The response contains the `session` and its first `run`, which executes the whole notebook. Wait for
that run as you would any other, with `GET /v2/runs/{runId}`.

- **The session works on its own copy** of the notebook, `session.sessionNotebookId`. The source
  notebook is never changed, and nobody in the editor sees the session's work.
- **It runs on its own machine.** Pass `machineType` (an id from `GET /v2/machine-types`) to use
  different hardware than the project, and `storageMode: "readonly"` to keep the project's persistent
  storage read-only.
- **It ends by itself** after `idleShutdownSeconds` without submissions (by default, the project's
  idle shutdown; capped at your workspace's maximum). `session.expiresAt` shows when, and each
  submission pushes it back.

Only the person whose API key created a session can use it.

## Send more work

Run the notebook again, or selected blocks, with new inputs:

```bash
curl -s -X POST "https://api.deepnote.com/v2/sessions/$SESSION_ID/runs" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notebookId": "'"$NOTEBOOK_ID"'",
    "blockIds": ["<block-id>", "<block-id>"],
    "inputs": { "region": "US" }
  }'
```

`notebookId` is always the source notebook (`session.notebookId`). `blockIds` and input names refer
to the session's copy; read them with `GET /v2/notebooks/{sessionNotebookId}`. Each submission
returns a `runId` to poll. Submissions made while the session is busy queue up and run in order.

To change what the session runs, edit its copy with the notebook and block endpoints
(`POST /v2/blocks`, `PATCH /v2/blocks/{blockId}`) and submit again. This is how an agent can write a
new block, run it, read the output and decide what to do next, all against data that is already
loaded.

### Run a snippet directly

For quick questions, send code straight to the kernel and get its outputs back in the response:

```bash
curl -s -X POST "https://api.deepnote.com/v2/sessions/$SESSION_ID/execute" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "notebookId": "'"$NOTEBOOK_ID"'", "code": "df.groupby(\"country\").revenue.sum().head()" }'
```

- The response holds Jupyter-style `outputs`. An exception in your code comes back as an output with
  `output_type: "error"`, not as an HTTP error.
- It waits up to `timeoutMs` (10 seconds by default, at most 120 seconds) and returns `408` if the
  code is still running then. It creates no snapshot, so use a submitted run for anything long or
  anything you want to keep.
- It needs edit access to the project and returns `409` while the notebook is busy with a run.

## Check on it, interrupt it, stop it

| Request                                                     | Does                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /v2/sessions/{sessionId}/status?notebookId=…`          | The session (`idle`, `busy` or `terminated`) and the kernel: what is executing and what is queued |
| `POST /v2/sessions/{sessionId}/interrupt` with `notebookId` | Interrupts the running code and queued runs for that notebook; the session stays alive            |
| `DELETE /v2/sessions/{sessionId}`                           | Stops everything, shuts the machine down and ends the session                                     |

A session uses machine time until it ends, so stop it as soon as you are done instead of waiting for
idle shutdown.

## Related

- [Running notebooks](/docs/deepnote-api-runs): one-off runs and reading outputs
- [Machines](/docs/deepnote-api-machines): hardware and machine time
- [Deepnote MCP](/docs/deepnote-mcp): give an AI agent Deepnote without writing API calls
- [API reference](/docs/api-reference)
