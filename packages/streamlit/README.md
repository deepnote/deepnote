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

For an existing cloud notebook, no sidecar is needed:

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

## When to use the sidecar

Use `DeepnoteCloudRunner` when the local file corresponds to an existing Deepnote notebook. Use the
sidecar when the app needs to create or synchronize the cloud notebook from the file, or execute it
in a local kernel. `@deepnote/local-runner` owns those heavier workflows, including input coercion,
cloud notebook creation, snapshots, and local kernel lifecycle.

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
