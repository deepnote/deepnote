# Lindquett Software: five data apps, from a local notebook to Deepnote

Lindquett Software is a fictional B2B SaaS company with about 1,200 customer accounts. These are five
tools its teams use, each a notebook with an app on top, and each the worked example for one or more
of the [Deepnote playbooks](https://deepnote.com/docs). All five read revenue from the same two
modules, so no app disagrees with another.

The data is synthetic and seeded, so every run sees the same numbers, and it has a story to find:
EMEA net revenue retention falls from about 100% to 88% in 2026-Q3. One enterprise churn and two
contractions drive it, along with higher churn among SMB and Mid-market accounts moved to the 2026
price list in July.

## The apps

| App                                          | Who opens it               | What the notebook does                                                                                        | Playbooks                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Revenue review](revenue-review/)            | Leadership and RevOps      | KPIs, the ARR bridge and the accounts behind each change; an agent block writes the analyst note              | [One definition of every metric](https://deepnote.com/docs/playbook-one-definition-of-every-metric), [Trustworthy AI answers](https://deepnote.com/docs/playbook-trustworthy-ai-answers), [Reports that deliver themselves](https://deepnote.com/docs/playbook-reports-that-deliver-themselves) |
| [Renewal deal desk](deal-desk/)              | Account managers           | Prices a renewal and explains it; the CRM calls the same notebook through the runs API                        | [Self-serve tools](https://deepnote.com/docs/playbook-self-serve-tools), [Notebook as a backend](https://deepnote.com/docs/playbook-notebook-as-a-backend), [Least-privilege data access](https://deepnote.com/docs/playbook-least-privilege-data-access)                                       |
| [Account health](account-health/)            | Customer success           | Scores churn risk with reasons; after each warehouse load, posts accounts that crossed the threshold to Slack | [Business alerts](https://deepnote.com/docs/playbook-business-alerts), [Orchestrator-triggered runs](https://deepnote.com/docs/playbook-orchestrator-triggered-runs)                                                                                                                            |
| [Data health](data-health/)                  | Anyone reading a dashboard | The data checks that also gate every pull request and warehouse load                                          | [Data quality checks](https://deepnote.com/docs/playbook-data-quality-checks)                                                                                                                                                                                                                   |
| [Pricing scenario planner](pricing-planner/) | Finance                    | A scheduled notebook writes the pricing baseline; a Streamlit app models price changes on it                  | [Choosing how to build an app](https://deepnote.com/docs/playbook-choosing-an-app-type)                                                                                                                                                                                                         |

The first four are [data apps](https://deepnote.com/docs/data-app-projects): an HTML page that runs its
notebook and reads the notebook's `application/json` output. The planner is a
[Streamlit app](https://deepnote.com/docs/streamlit-app-projects), because it is all Python
interaction on data that changes once a day.

## Try it on your machine

You need Python 3.10 or later with `deepnote-toolkit[server]`, and `streamlit` for the planner
(`pip install "deepnote-toolkit[server]" -r examples/lindquett-software/pricing-planner/requirements.txt`).
From the repository root:

```bash
pnpm example:lindquett          # builds the packages, then open http://127.0.0.1:4747
```

The hub links all five apps. Each data app is served from the same directory `deepnote publish` would
upload, and its notebook runs in a local kernel. For the Revenue review's analyst note, put
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `examples/lindquett-software/local/.env`; without one, the
numbers still load and the note says why it is missing.

Run any notebook on its own with `deepnote run`, which is how CI uses them:

```bash
node examples/lindquett-software/local/run.mjs data-health --input simulate_issue="Late load"   # exits 1
node examples/lindquett-software/local/run.mjs account-health --input notify=false
node examples/lindquett-software/deal-desk/crm-client.mjs ACC-1003 3 --local                   # what the CRM gets
```

## How each app is built

The same loop, with a coding agent that has the Deepnote skill (`deepnote install-skills`):

1. **Write the notebook.** Ask the agent for it, for example: _"In deal-desk.deepnote, price a renewal
   for `account_id` and `term_years` with the rules in the Pricing rules block. Load accounts and
   revenue with module blocks from the Lindquett metrics project. End with one `application/json`
   output holding the quote and a plain-language reason for each part of the price."_ Run it with
   `node local/run.mjs deal-desk` and review the change with `git diff`.
2. **Build the page.** Ask for `deal-desk/app/index.html`: _"An account picker on the left and the
   quote on the right. Run the notebook with `runNotebook` from `deepnote-app.js` when the account or
   term changes."_ Try it at http://127.0.0.1:4749, against the same notebook.
3. **Ship it.** Push the notebook to Deepnote and publish the page into a data app project:

   ```bash
   node examples/lindquett-software/local/serve.mjs   # also writes local/build/deal-desk/site
   deepnote publish examples/lindquett-software/local/build/deal-desk/site --create "Renewal deal desk"
   ```

   `--create` makes the data app project and prints its ID; use `--project-id` from then on. Put the
   notebook in that project, and check that `<meta name="deepnote-notebook-id">` in the page names it.

`shared/deepnote-app.js` is what makes one page work in both places: locally it calls the launcher's
`/api/run`, and inside Deepnote it gets a short-lived viewer token from the Deepnote shell and runs the
notebook with the runs API.

## In Deepnote

- **Metrics.** Import `metrics/lindquett-metrics.deepnote` and publish `Revenue data` and
  `Revenue metrics` as modules. Each app's module blocks point at them.
- **Schedules and alerts.** Schedule the Revenue review every Monday so the app opens on fresh numbers,
  and the pricing baseline daily. Add `SLACK_WEBHOOK_URL` and `ACCOUNT_HEALTH_URL` to the Account
  health project, and trigger it after the warehouse load with
  [`account-health/ci/after-warehouse-load.yml`](account-health/ci/after-warehouse-load.yml), which runs
  the data checks first.
- **CI.** Copy [`data-health/ci/data-quality.yml`](data-health/ci/data-quality.yml) to
  `.github/workflows/` to run the checks on every pull request.
- **Access.** Share the deal desk with account managers at **App user** access, so they can use the app
  without seeing the notebook or the pricing logic's code.

To point the apps at real data, replace the generator in `Revenue data` with SQL against your warehouse
that returns the same three tables. Every app keeps working.

## What has been checked

Everything above runs locally. Nothing has run in Deepnote yet: pushing these notebooks into data app
projects, module blocks across projects, and agent blocks in a published app are untested.

## Files

| Path                     | What it is                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `metrics/`               | The `Revenue data` and `Revenue metrics` modules every app uses                                          |
| `<app>/<app>.deepnote`   | The app's notebook                                                                                       |
| `<app>/app/`             | The data app's page                                                                                      |
| `shared/`                | The run client, chart helpers and styles every page uses; copied next to each page when published        |
| `pricing-planner/app.py` | The Streamlit app                                                                                        |
| `local/`                 | `serve.mjs` runs everything, `run.mjs` runs one notebook, `build.mjs` swaps module blocks for local code |
