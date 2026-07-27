# Durable notebook orchestration with Workflow SDK

This is the durable form of the neighboring one-shot demo. It uses the
[`workflow`](https://www.npmjs.com/package/workflow) package's local world, compiler, event log,
retries, and observability while every notebook and agent block executes in Deepnote Cloud.

From the repository root:

```bash
DEEPNOTE_TOKEN=... pnpm example:workflow-orchestration
```

Then start a pipeline:

```bash
curl -X POST --json '{"region":"Europe"}' http://localhost:3000/api/run
```

Inspect runs in another terminal:

```bash
pnpm --filter @deepnote/example-workflow-orchestration exec workflow inspect runs
pnpm --filter @deepnote/example-workflow-orchestration exec workflow web
```

`DEEPNOTE_TOKEN` stays inside each Workflow SDK step and is read by `runInCloud`; it is not a
workflow argument. The local Workflow SDK world writes development state to `.workflow-data/`,
while Deepnote owns the actual notebook and agent execution.

The SDK normally retries failed steps three times. `runNotebookStep` deliberately sets
`maxRetries = 0`: a notebook or agent may write files, mutate databases, or incur model cost.
Applications should add retries only after making those effects idempotent.

The `workflows/deepnote.ts` re-export is intentional. It lets Workflow SDK's consumer-side compiler
assign stable IDs to the step exported by `@deepnote/local-runner/workflows`, so replay and cold
starts can resolve it.
