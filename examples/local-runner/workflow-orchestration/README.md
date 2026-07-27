# Durable regional decision pipeline

This demo is deliberately more than “call three notebooks.” It shows the end-to-end value of
orchestrating Deepnote runs as a durable business process:

```text
Seed cloud notebook
        │
        ├── Europe analysis ─────── quality < 95% ──┐
        └── Asia Pacific analysis ─ source failure ─┤
                                                    ▼
North America result                     Conditional recovery runs
        │                                           │
        └──────────────────┬────────────────────────┘
                           ▼
                 Validated portfolio
                           │
                           ▼
                  Agent decision memo
```

The default stress scenario injects two realistic problems:

- Asia Pacific's first source read fails. The failed notebook is returned as data instead of
  aborting the whole workflow, and only that region is rerun safely.
- Europe's source is missing one month. A 95% quality gate detects it, and only Europe is rerun
  with backfilling enabled.

The successful regional results are then aggregated into a portfolio decision and passed as
structured input to a separate notebook whose agent writes the final executive memo. The workflow
returns the decision, metrics, Deepnote report link, and an audit summary of the branches that ran.

## Run the complete demo

Set `DEEPNOTE_TOKEN`, then start the local Workflow SDK world from the repository root:

```bash
pnpm example:workflow-orchestration
```

In a second terminal, start the scenario and wait for its final result:

```bash
pnpm example:workflow-orchestration:run
```

The driver prints status changes while the durable workflow runs, followed by evidence of the value
the orchestration added:

```text
Why orchestration mattered
──────────────────────────
Parallel fan-out branches: 2
Failures contained:        Asia Pacific
Quality gates triggered:   Europe
Regions recovered:         Europe, Asia Pacific
Durable notebook runs:     6
Agent completed:           yes

Decision
────────
INTERVENE
```

You can also start custom scenarios directly:

```bash
curl -X POST --json '{
  "demandShockPct": -5,
  "qualityThreshold": 0.9,
  "simulateFailureRegion": null
}' http://localhost:3000/api/run
```

Poll the returned `statusUrl` to retrieve the result, or inspect the step timeline:

```bash
pnpm --filter @deepnote/example-workflow-orchestration exec workflow inspect runs
pnpm --filter @deepnote/example-workflow-orchestration exec workflow web
```

## What is durable, and what runs in Deepnote?

Workflow SDK owns the orchestration timeline: fan-out, checkpoints, conditional recovery, status,
and the final return value. Its local development world writes state to `.workflow-data/`.

Deepnote Cloud owns each notebook execution, including the final agent. `DEEPNOTE_TOKEN` is read
inside each durable step and never becomes a workflow argument or event-log value.

`runNotebookStep` uses `maxRetries = 0` because arbitrary notebook and agent side effects are not
automatically safe to repeat. This demo makes retries explicit as recovery branches, with new step
IDs and inputs that show exactly why each rerun occurred.

The `workflows/deepnote.ts` re-export lets the consumer-side Workflow SDK compiler assign a stable ID
to the step exported by `@deepnote/local-runner/workflows`, so replay and cold starts can resolve it.
