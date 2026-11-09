# Lindquett Software: one analytics project, from dashboard to alert to API

Lindquett Software is a fictional B2B SaaS company with about 1,200 customer accounts. This example is its
analytics project in Deepnote: one `.deepnote` file where a dashboard, a scheduled alert, a data
quality gate, an API endpoint and an AI analyst all calculate revenue from the same two modules.
Each notebook is the worked example for one of the [Deepnote playbooks](https://deepnote.com/docs).

The data is synthetic and seeded, so every run sees the same numbers, and it has a story to find:
EMEA net revenue retention falls from about 100% to 88% in 2026-Q3. One enterprise churn and two
contractions drive it, along with higher churn among SMB and Mid-market accounts moved to the 2026
price list in July.

## What's in the project

| Notebook              | What it does                                                                                                                 | Playbook                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Revenue data`        | Module exporting the governed tables `accounts`, `mrr` and `opportunities`                                                   | [One definition of every metric](https://deepnote.com/docs/playbook-one-definition-of-every-metric)                                                                                                                                                                 |
| `Revenue metrics`     | Module exporting ARR, NRR, GRR and pipeline coverage as functions                                                            | [One definition of every metric](https://deepnote.com/docs/playbook-one-definition-of-every-metric)                                                                                                                                                                 |
| `Revenue review`      | Data app: filters, KPIs, charts and tables, then an agent block that answers the viewer's own question with the same metrics | [Self-serve tools](https://deepnote.com/docs/playbook-self-serve-tools), [Trustworthy AI answers](https://deepnote.com/docs/playbook-trustworthy-ai-answers), [Reports that deliver themselves](https://deepnote.com/docs/playbook-reports-that-deliver-themselves) |
| `Revenue drop alert`  | Scheduled check that posts to Slack when a region's NRR falls, with the accounts behind it                                   | [Business alerts](https://deepnote.com/docs/playbook-business-alerts), [Orchestrator-triggered runs](https://deepnote.com/docs/playbook-orchestrator-triggered-runs)                                                                                                |
| `Data quality checks` | SQL checks on the module's tables that fail the run, in CI and on a schedule                                                 | [Data quality checks](https://deepnote.com/docs/playbook-data-quality-checks)                                                                                                                                                                                       |
| `Renewal quote`       | Endpoint that returns a renewal price and churn-risk tier as JSON for the CRM                                                | [Notebook as a backend](https://deepnote.com/docs/playbook-notebook-as-a-backend)                                                                                                                                                                                   |

Other files:

- `local/`: runs the notebooks on your machine. `serve.mjs` and `index.html` preview the app,
  `run.mjs` runs any other notebook with `deepnote run`, and `build.mjs` is what both use to replace
  module blocks (see [Running locally](#running-locally)).
- `ci/data-quality.yml`: a GitHub Actions workflow that runs the quality checks on every pull request.
- `ci/after-warehouse-load.yml`: a workflow that runs the alert in Deepnote when an upstream
  pipeline says the data is ready.
- `clients/renewal-quote.mjs`: what the CRM does to get a quote through the runs API.

## Try it

From the repository root:

```bash
# The app. Put ANTHROPIC_API_KEY or OPENAI_API_KEY in examples/lindquett-software/local/.env for the agent.
pnpm example:lindquett                       # builds the packages, then open http://127.0.0.1:4747

# The alert. Without SLACK_WEBHOOK_URL it prints the message it would send.
node examples/lindquett-software/local/run.mjs "Revenue drop alert"

# The quality gate. Exits 1 when a check fails; pick an issue to see one fail.
node examples/lindquett-software/local/run.mjs "Data quality checks" --input simulate_issue="Late load"

# The endpoint, as the CRM would call it.
node examples/lindquett-software/clients/renewal-quote.mjs ACC-1003 3 --local
```

`run.mjs` passes everything after the notebook name to `deepnote run`, such as `--input`,
`-o json` or `--python`, and keeps its exit code.

## Running locally

A local kernel runs everything in this project except two things that need Deepnote:

- **Modules.** A module block asks Deepnote to run the module notebook and return its exports.
  `local/build.mjs` writes a copy of the notebook to `local/build/` with each module block replaced
  by the module's code, and a `.deepnote.env.yaml` for the data frame SQL connection. The shipped
  `lindquett.deepnote` is unchanged.
- **The agent in the app.** Locally the agent block runs on the open-source runtime, with Claude
  when `ANTHROPIC_API_KEY` is set (set `PREVIEW_AGENT_MODEL` to choose a model). Deepnote runs its
  own agent with the workspace's model, so answers differ in style and tools.

The app preview lays the page out from the same app metadata Deepnote uses (rows, columns, widths,
visibility) and approximates Deepnote's styling, including its chart theming.

## Using it in Deepnote

Import `lindquett.deepnote` into a workspace, or let a first cloud run create the project:
`deepnote run lindquett.deepnote --cloud --notebook "Data quality checks"`. Then set what a `.deepnote` file does not store:

1. Mark `Revenue data` and `Revenue metrics` as modules (**Publish as a module**), and check that
   each module block still points at them.
2. Open `Revenue review` and select **Create app**. The block layout comes from the file. In App
   settings, turn **off** _Run on input change_ so the agent runs only when a viewer presses
   **Run**, choose _Show last run results_, and share it with the workspace. Agent blocks run only
   for app viewers with edit access.
3. Schedule `Revenue drop alert` every weekday morning, and add `SLACK_WEBHOOK_URL` and
   `REVENUE_REVIEW_URL` (the app's link) as environment variables. Or turn on _Fail the run when
   alerting_ and use the schedule's failure notifications instead.
4. Schedule `Data quality checks` daily with failure notifications on, and copy
   `ci/data-quality.yml` into `.github/workflows/` to run the same checks on pull requests.
5. To call `Renewal quote` from another system, create an API key and run
   `clients/renewal-quote.mjs` with `DEEPNOTE_TOKEN` and the notebook's ID in `NOTEBOOK_ID`.
6. Optional: schedule `Revenue review` too, so the app opens on an answered default question.

To point the project at real data, replace the generator in `Revenue data` with SQL blocks against
your warehouse that return the same three tables and columns. Every other notebook keeps working.
