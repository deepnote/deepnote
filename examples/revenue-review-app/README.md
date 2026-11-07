# Quarterly revenue review: a Deepnote data app with an AI analyst

A three-notebook Deepnote project that works as a real corporate data app:

| Notebook          | Role                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Revenue review`  | The app: filters, KPIs, charts and tables, then an **Ask the analyst** section where viewers type their own question and an agent block answers it. |
| `Revenue data`    | Module exporting the governed tables `accounts`, `mrr` and `opportunities` (synthetic, seeded, so every run sees the same numbers).                 |
| `Revenue metrics` | Module exporting the semantic layer as functions: `arr_movements`, `arr_bridge`, `retention`, `retention_trend`, `top_movers`, `pipeline_coverage`. |

The app calls both modules through notebook-function blocks, so the dashboard and the agent use one
definition of ARR, NRR, GRR and pipeline coverage. The agent's prompt is fixed; the viewer's
question reaches it through the `question` textarea input, and the filters set its default scope.

The synthetic data has a story to find: EMEA net revenue retention falls from about 100% to 88% in
2026-Q3. One enterprise churn and two contractions drive it, along with higher churn among SMB and
Mid-market accounts moved to the 2026 price list in July.

## Preview it locally

```bash
echo 'ANTHROPIC_API_KEY=...' > examples/revenue-review-app/preview/.env   # or OPENAI_API_KEY
pnpm example:revenue-review                  # from the repository root; builds the packages first
```

Open http://127.0.0.1:4747 and press **Run**. The page lays the app out from the same app metadata
Deepnote uses (rows, columns, widths, visibility) and runs the notebook in a local
`deepnote-toolkit` kernel. Without an API key, everything except the agent block still runs.

What the preview cannot reproduce exactly:

- **Modules.** A local kernel cannot call Deepnote's module backend, so `build-preview.mjs`
  inlines each module notebook in place of its module block. The shipped `.deepnote` file is
  unchanged.
- **The agent.** Locally the agent block runs on the open-source runtime (Claude by default, set
  `PREVIEW_AGENT_MODEL` to change it). Deepnote Cloud runs its own agent implementation with the
  workspace's model, so answers will differ in style and tools.
- **Styling.** The page approximates Deepnote's app renderer, including its chart theming.

## Files

| Path                                             | What it is                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `revenue-review.deepnote`                        | The project. Open it in VS Code or Cursor with the Deepnote extension, or import it into Deepnote. |
| `source/data.py`, `source/metrics.py`            | The module code, kept as plain Python so it is easy to edit.                                       |
| `source/build_project.py`                        | Generates `revenue-review.deepnote` from the two files above, including the app layout.            |
| `preview/serve.mjs`, `preview/build-preview.mjs` | The local preview server and the module-inlining step.                                             |
| `preview/index.html`                             | The app-style preview page.                                                                        |

To change the data or a metric, edit `source/`, then regenerate the project (needs PyYAML):

```bash
python3 examples/revenue-review-app/source/build_project.py examples/revenue-review-app/revenue-review.deepnote
```

## Using it in Deepnote

After importing the file into a Deepnote workspace, set the app settings that a `.deepnote` file
does not store:

1. Mark `Revenue data` and `Revenue metrics` as modules (**Publish as a module**), and check that
   the app's two module blocks still point at them.
2. Open `Revenue review` and select **Create app**. The block layout comes from the file.
3. In App settings: turn **off** _Run on input change_ so the agent runs only when a viewer presses
   **Run**; choose _Show last run results_; set permissions to **Workspace & collaborators**.
4. Agent blocks only run for app viewers with edit access, and need the agent block feature enabled
   for the workspace.
5. Optional: schedule a daily run so the app opens on an answered default question.
