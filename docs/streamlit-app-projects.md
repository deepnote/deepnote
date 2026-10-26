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

- **The app:** Python code in `app.py`, hosted on the project's machine. It reloads whenever its code changes, and its [status](/docs/streamlit#app-status) shows whether it's live, sleeping, or deploying.
- **The notebook:** where the agent explores data and tests queries before moving them into the app. The app runs separately and can't see the notebook's variables, so it loads its own data.

To see the notebook, click **Show notebook** in the top bar. Click **Show app** to go back.

### Data and integrations

The app can query the integrations connected to the project, the same way as other [Streamlit apps](/docs/streamlit#using-integrations). With OAuth integrations, such as Snowflake OAuth or BigQuery with Google OAuth, each viewer signs in and sees data with their own access.

### AI summaries

The app can show text written by an agent block in the notebook, such as a summary of the latest numbers. Ask the agent to add one. The app runs the notebook for each viewer once per session, so the summary matches the data they see.

This uses the app's API access, which is on by default. You can turn it off with **Allow API access for all Streamlit apps in this project** in the app's settings.

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
