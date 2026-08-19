# deepnote-streamlit

Small Python helpers for custom Streamlit apps backed by local `.deepnote` files.

The package deliberately separates the notebook contract from the app UI:

- `DeepnoteDocument` parses a source file or snapshot and exposes typed inputs and structured
  outputs.
- `render_inputs` maps every Deepnote input block to a native Streamlit widget.
- `DeepnoteCloudRunner` calls the Deepnote public API directly with a static or renewable bearer
  token.
- `DeepnoteRunner` calls the local app API from `@deepnote/local-runner`. The sidecar may target
  Deepnote Cloud or a local kernel.

That leaves the app author—or an agent—with normal Python and Streamlit:

```python
from pathlib import Path

import streamlit as st
from deepnote_streamlit import DeepnoteDocument, DeepnoteRunner, render_inputs

notebook = DeepnoteDocument.load(Path("report.deepnote"))
values = render_inputs(notebook.inputs, st.sidebar)

if st.button("Run"):
    result = DeepnoteRunner().run(values)
    st.dataframe(result.first_dataframe().records())
```

For an existing, already-synchronized cloud notebook, no sidecar is needed:

```python
from deepnote_streamlit import DeepnoteCloudRunner

runner = DeepnoteCloudRunner(
    notebook_id="your-notebook-id",
    token_provider=get_current_token,
)
result = runner.run(values)
```

The provider is invoked for every request, so applications can supply renewable, short-lived
credentials without the library retaining them. A fixed `token=` or the `DEEPNOTE_TOKEN`
environment variable is convenient for local development.

## Synchronize at deployment, run at request time

`DeepnoteCloudRunner` deliberately does not update notebook source. Synchronization can delete or
recreate blocks, so it belongs in an explicit deployment step rather than in a viewer's Streamlit
request:

```bash
# Preview the local-to-cloud block plan without changing or running anything.
deepnote run report.deepnote --cloud --notebook-id "$DEEPNOTE_NOTEBOOK_ID" --push --dry-run

# Apply the approved plan, then run the deployed notebook once.
deepnote run report.deepnote --cloud --notebook-id "$DEEPNOTE_NOTEBOOK_ID" --push --yes
```

At runtime, `RunnerInfo.accepts_inputs(document.inputs)` verifies that the deployed notebook still
has the same input names and types before an app submits values. This keeps the Python runtime
small and read/run-only while the CLI owns the reviewed, potentially destructive sync operation.

## When to use the sidecar

Use `DeepnoteCloudRunner` when the local file corresponds to an existing Deepnote notebook. Use the
sidecar when local development needs cloud notebook creation fallback or execution in a local
kernel. It does not silently update an existing cloud notebook; use the deployment sync above when
the file changes. `@deepnote/local-runner` owns input coercion, cloud notebook creation, snapshots,
and local kernel lifecycle.

The runner's target is a deployment setting, not an app concern:

```javascript
await serveStatic({
  dir: "./public",
  notebookPath: "./report.deepnote",
  // runTarget: "local", // omit for Deepnote Cloud
});
```

See [`examples/streamlit`](../../examples/streamlit) for complete static and dynamic apps.

## Development

```bash
uv run --project packages/streamlit --extra dev ruff format --check packages/streamlit examples/streamlit
uv run --project packages/streamlit --extra dev ruff check packages/streamlit examples/streamlit
uv run --project packages/streamlit --extra dev pytest
```
