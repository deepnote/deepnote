---
title: Data app projects
description: Describe a dashboard or data tool, and Deepnote Agent builds it as a web app backed by a notebook.
noIndex: false
noContent: false
---

<Callout status="info">
Data app projects are in beta. This is an early version, so expect it to change, and tell us what you'd like it to do.
</Callout>

A data app project is a web app you build by chatting with [Deepnote Agent](/docs/deepnote-agent). Describe what you need, such as a sales dashboard, a data explorer, or an interactive tool, and the agent builds the app and connects it to a notebook that queries and prepares the data. Refine it in chat and share it with your team.

To publish blocks from an existing notebook as an app instead, see [Data apps](/docs/data-apps).

## Creating a data app

1. Click **Create new** in your workspace and choose **New data app**.
2. Describe the app you want, or pick one of the suggested prompts.
3. The agent looks for data in your connected integrations and project files and builds a first version. If nothing fits, it uses clearly labeled sample data and offers to connect real data.

After your first prompt, the app opens next to the chat. Keep asking for changes, such as a new chart, another filter, or a different layout, and the agent updates the app.

## How a data app works

A data app has two parts:

- **The page:** an HTML page with its own styles and scripts, stored in `_deepnote_static/index.html`. Filtering, sorting, and charts run in the page.
- **The notebook:** runs the SQL and Python behind the app and returns the data the page needs. Queries, credentials, and heavy computation stay in the notebook, never in the page.

To see the notebook, click **Show notebook** in the top bar. Click **Show app** to go back.

### Data and refreshes

Each person who opens the app sees data from their own latest run of the notebook. When they refresh the app or submit its inputs, the whole notebook runs again for them and the app shows the new results. The first time someone opens the app, it may ask them to run the notebook to load their data.

Running blocks in the editor doesn't change what the app shows.

### Inputs

The app's controls use the notebook's [input blocks](/docs/input-blocks). When someone changes a control and submits, the notebook runs with their values.

### AI summaries

The app can show text written by an agent block in the notebook, such as a summary of the latest numbers. Ask the agent to add one. The summary is written on each run, so it matches the data the viewer sees.

### Using data from another app

A data app can show another app's data by connecting to that app's notebook instead of copying its queries. Ask the agent to use the other app's data. People who open your app need at least **View** access to the other app's project.

## Fixing errors

After each change, the agent reloads the app, checks it for errors, and fixes them on its own. If an error is still there after two tries, it tells you what's still failing.

If the app hits an error while you're using it, a message appears above the app. Click **Fix** to let the agent fix it.

## Changing the look

New apps use a calm, Deepnote-like theme with light and dark modes. Ask the agent for another look, such as your brand's colors and fonts.

## Publishing and sharing

A new data app is unpublished, so only editors of the project can open it. To let others use it:

1. Click **Share** in the top bar and set the app to **Published**.
2. Invite people, groups, or your workspace, and choose their access:
   - **App user:** can open and use the published app, but can't see the notebook or the app's code. New collaborators get this access by default.
   - **View:** can also open the project and see the notebook and the app's code, without changing them.
   - **Edit:** can change the app and the notebook, use the agent, and publish or unpublish the app.
3. Click **Copy link to app** and send the link.

To make the app editor-only again, set it to **Unpublished**.

Published apps open only when **Allow static file sharing in projects** is on in **Settings & members → Project settings**.

## Limitations

- Data apps can be shared only with people who have access to the project. Sharing with anyone who has the link isn't available.
