---
title: Streamlit app projects
description: Describe an interactive Python app, and Deepnote Agent writes and hosts it with Streamlit.
noIndex: true
noContent: false
---

<Callout status="info">
Streamlit app projects are in beta. This is an early version, so expect it to change, and tell us what you'd like it to do.
</Callout>

A Streamlit app project is a [Streamlit](https://streamlit.io) app you build by chatting with [Deepnote Agent](/docs/deepnote-agent). Describe what you need, such as a forecasting tool, a CSV explorer, or a dashboard, and the agent writes the Python code, hosts the app, and adds controls that rerun your analysis as people use them. Refine it in chat and share it with your team.

To host a Streamlit script in a regular project instead, see [Streamlit apps](/docs/streamlit).

## Creating a Streamlit app

1. Click **Create new** in your workspace and choose **New Streamlit app**.
2. Describe the app you want, or pick one of the suggested prompts.
3. The agent looks for data in your connected integrations and project files, writes the app, and checks that it runs. If nothing fits, it uses clearly labeled sample data and offers to connect real data.

After your first prompt, the app opens next to the chat. Keep asking for changes, such as a new chart, another filter, or a different layout, and the agent updates the app.

## How a Streamlit app works

A Streamlit app project has two parts:

- **The app:** Python code in `app.py`, hosted on the project's machine. By default, it reloads whenever its code changes, and its [status](/docs/streamlit#app-status) shows whether it's live, sleeping, or deploying.
- **The notebook:** where the agent explores data and tests queries before moving them into the app. The app runs separately and can't see the notebook's variables, so it loads its own data.

To see the notebook, click **Show notebook** in the top bar. Click **Show app** to go back.

### Data and integrations

The app can query the integrations connected to the project, the same way as other [Streamlit apps](/docs/streamlit#using-integrations). With OAuth integrations, such as Snowflake OAuth or BigQuery with Google OAuth, each viewer signs in and sees data with their own access.

### AI summaries

The app can show text written by an agent block in the notebook, such as a summary of the latest numbers. Ask the agent to add one. The app runs the notebook for each viewer once per session, so the summary matches the data they see.

This uses the app's API access, which is on by default. You can turn it off with **Allow API access for all Streamlit apps in this project** in the app's settings.

### Running the notebook from the app

The app can use the notebook as its backend for interactive work. The notebook keeps the SQL,
credentials and heavy work; the app turns the notebook's [input blocks](/docs/input-blocks) into a
form, runs the notebook with the viewer's values and shows what it returns. Ask the agent to build
the app this way, or write it yourself with the helpers in `deepnote-toolkit` 2.8.0 and later:

```python
import streamlit as st
from deepnote_toolkit.notebooks import DeepnoteDocument, RunnerError
from deepnote_toolkit.streamlit import StreamlitCloudRunner, render_inputs

notebook_id = "your-notebook-id"
document = DeepnoteDocument.load("report.deepnote", notebook_id=notebook_id)
runner = StreamlitCloudRunner(notebook_id)

values = render_inputs(document.inputs, st.sidebar)

if st.button("Run"):
    try:
        result = runner.run(values)
        if not result.success:
            st.error(result.error or "The run failed.")
        elif result.snapshot_status == "pending":
            st.info("No outputs are available. A notebook with no blocks to run stays pending.")
        elif (table := result.first_dataframe()) is not None:
            st.dataframe(table.records(include_index=False))
        else:
            st.write(result.text())
    except RunnerError as error:
        st.error(str(error))
```

Export the notebook as a `.deepnote` file and add it to the project's files next to `app.py`; the app
reads the input definitions from it.

Each run is started as the current viewer, using the app's API access. Viewers need at least
**App user** access to the project (see [Sharing](#sharing)), and no permission to execute. Inside
the run, queries use whatever credentials the integration holds. For a shared integration that is
the stored connection, so the app can return data the viewer has no direct access to in the source
system. Use an [OAuth integration](/docs/streamlit#per-viewer-authentication-with-oauth-integrations)
when queries must run as the viewer in the database too.

- **`render_inputs`** draws a Streamlit widget for each input block (text, select, slider,
  checkbox, date and date range) with the notebook's saved values as defaults, and returns the values
  to run with. A single select with nothing chosen, or a date range with only one end picked, is
  left out, so the run uses the notebook's saved value. A multi-select with nothing chosen runs as an
  empty list, and a text or date field the viewer clears runs as empty. File inputs appear as a text
  path; the helper does not upload files.
- **`StreamlitCloudRunner.run`** starts a detached run in Deepnote as the current viewer, waits for it
  (up to `timeout`, 600 seconds by default) and returns its outputs. It never falls back to your own
  token: if the viewer's credentials are not available, the call fails. Call it from the Streamlit
  script itself, not from a worker thread.
- **Results** give you `result.text()` for text output, `result.agent_text()` for an agent block's
  text, and `result.first_dataframe()` for the first table. Tables arrive as a preview page, so check
  `row_count` and `is_truncated` before treating one as complete.
- **Storage** is read-only by default: the notebook can read the project's files but not change them.
  Pass `storage_mode="read_write"` when it needs to write.
- **Drift check.** `runner.info().matches_inputs(document.inputs)` tells you whether the notebook's
  inputs still match the `.deepnote` file the app was built from.

To run the app on your machine against Deepnote, add `import os` to the app and opt into your own
API key with
`StreamlitCloudRunner(notebook_id, local=True, token=os.environ["DEEPNOTE_TOKEN"])`. In Deepnote,
`local=True` and the token are ignored and the viewer's credentials are used.
`DeepnoteDocument.load("report.snapshot.deepnote")` loads saved outputs from a
[run snapshot](/docs/run-snapshots), so you can build the layout without running anything.

For other API calls as the viewer, `deepnote_toolkit.streamlit.current_user_api_credentials()`
returns the viewer's short-lived token and the API origin it is valid for. The token can read the
notebook's inputs, start detached runs, and read the viewer's own runs and their
[app data](/docs/deepnote-api-runs#return-structured-data-from-a-notebook); other endpoints return
`403`. To build the same kind of app as a web page instead of in Python, see
[Data app projects](/docs/data-app-projects).

## Changing the look

New apps use a calm, Deepnote-like theme with light and dark modes, set in `.streamlit/config.toml` next to `app.py`. Ask the agent for another look, such as your brand's colors and fonts.

## Sharing

Everyone with access to the app sees your changes as soon as the app reloads. To let others use it:

1. Click **Share** in the top bar.
2. Invite people, groups, or your workspace, and choose their access:
   - **App user:** can open and use the app, but can't see the notebook or the app's code. New collaborators get this access by default.
   - **View:** can also open the project and see the notebook and the app's code, without changing them.
   - **Edit:** can change the app and the notebook, and use the agent.
3. Click **Copy link to app** and send the link.

## Limitations

- Streamlit apps can be shared only with people who have access to the project. Sharing with anyone who has the link isn't available.
