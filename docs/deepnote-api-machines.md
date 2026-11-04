---
title: Managing machines with the Deepnote API
description: Start, stop and restart a project's machine, change its hardware, and set idle shutdown through the Deepnote API to have machines ready when needed and off when not
noIndex: false
noContent: false
---

Every project has a machine that powers its editor, its live runs and its hosted
[Streamlit apps](/docs/streamlit). The API lets you control that machine from your own tools: have it
running before people need it, upgrade it for a heavy job, and switch it off so it stops using
[machine hours](/docs/machine-hours).

Detached [runs](/docs/deepnote-api-runs) and [interactive sessions](/docs/deepnote-api-sessions)
start machines of their own, so you do not need to start the project machine for them.

All examples use `$DEEPNOTE_TOKEN`; see [Authentication](/docs/deepnote-api#authentication).

## Check a machine

```bash
curl -s "https://api.deepnote.com/v2/projects/$PROJECT_ID/machine" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN"
```

```json
{
  "machine": {
    "status": "running",
    "type": {
      "id": "ocean",
      "name": "…",
      "vCpus": 4,
      "memoryGiB": 16,
      "gpuCount": 0
    },
    "idleShutdownSeconds": 900,
    "error": null
  }
}
```

`status` is `stopped`, `starting`, `running`, `stopping` or `error`. While a machine starts,
`startingPhase` says whether it is `waiting_for_capacity` or `pulling_image`. The endpoint is cheap
enough to poll.

## Start, stop and restart

```bash
curl -s -X POST "https://api.deepnote.com/v2/projects/$PROJECT_ID/machine/start" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN"
```

| Request                                         | Does                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /v2/projects/{projectId}/machine/start`   | Starts the machine and returns at once; poll until `status` is `running`. Already running is a no-op |
| `POST /v2/projects/{projectId}/machine/stop`    | Stops the machine. Files are kept; variables in memory are lost for everyone in the project          |
| `POST /v2/projects/{projectId}/machine/restart` | Replaces the machine with a fresh one. Use it to recover a machine in `error`                        |

All three are safe to repeat. A `409` explains what is in the way, for example a machine that is still
stopping or a plan's machine limit.

## Change the hardware or idle shutdown

`GET /v2/machine-types` lists the machine types and sandbox environments your workspace can use,
with their CPUs, memory and GPUs, and whether each is `available` on your plan.

```bash
curl -s -X PATCH "https://api.deepnote.com/v2/projects/$PROJECT_ID/machine" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "type": "<machine-type-id>", "idleShutdownSeconds": 3600, "restart": true }'
```

- **`idleShutdownSeconds`** (up to 24 hours) applies immediately.
- **`type`** and **`sandboxEnvironmentId`** apply on the machine's next start. A running machine
  needs `"restart": true` — without it the request returns `409` and changes nothing — and
  restarting loses the kernel's variables.
- To use bigger hardware for a single job without changing the project, pass `machineType` to a
  [run](/docs/deepnote-api-runs) or [session](/docs/deepnote-api-sessions) instead.

## Recipes

- **Ready before people arrive.** A scheduled job calls `start` at 08:45 on weekdays, so the first
  person to open a heavy project does not wait for it to boot or for its init notebook to install
  packages.
- **Off when nobody is working.** A nightly job lists projects with `GET /v2/projects`, checks each
  machine and calls `stop` on those still `running`. Set a short `idleShutdownSeconds` on projects
  that do not need to stay warm.
- **Bigger hardware for crunch time.** Switch a project to a GPU or high-memory type before a
  training sprint, and back afterwards, from the same script.
- **Self-healing.** A monitor that sees `error` calls `restart` and waits for `running`.

## Related

- [Selecting hardware](/docs/selecting-hardware) and [Machine hours](/docs/machine-hours)
- [Long-running jobs](/docs/long-running-jobs)
- [Deepnote API](/docs/deepnote-api) and the [API reference](/docs/api-reference)
