---
title: Private outputs
description: Run a project privately so each person's results, variables and input values stay their own, while code and files stay shared.
noIndex: true
noContent: false
---

<Callout status="info">
Private outputs are in beta. This is an early version, so expect it to change, and tell us what you'd like it to do.
</Callout>

With private outputs on, a project runs privately: everyone works on the same notebooks, but each person runs them on their own machine with their own credentials, and only they see the results. Use it when people query data with their own identity, for example through a [BigQuery](/docs/bigquery-oauth) or [Snowflake](/docs/snowflake-oauth) OAuth integration, and one person's results must never be shown to another.

This is different from a [private project](/docs/share-projects), which controls who can open a project. Private outputs control who sees the results inside it.

## Turning on private outputs

Project admins and editors can turn on private outputs:

1. Open the project settings sidebar and go to the **Machine** section.
2. Under **More options**, set **Private outputs** to **On**.
3. Confirm in the dialog.

When you connect an OAuth integration to a project that doesn't run privately, Deepnote suggests turning it on with the dialog **Run this project privately?**.

Private outputs are available on the Pro plan, including the Pro trial, and on the Enterprise plan. If the plan lapses later, the project keeps running privately.

<Callout status="warning">
Private outputs can't be turned off. Turning them on also clears the project's existing results, so everyone starts empty:

- block outputs, run snapshots and stored variables are deleted
- the project machine stops and runs in progress are cancelled
- outputs are removed from every version in the version history
</Callout>

Your editor reloads after the change. Anyone else with the project open sees **This project now runs privately. Reload to continue.** the next time they run a block. The notebook status bar shows a **Private outputs** icon in every project that runs privately.

A duplicate of the project also runs privately.

## What's shared and what's personal

| Shared with everyone in the project      | Personal to each person     |
| ---------------------------------------- | --------------------------- |
| Code, notebooks and blocks               | Block outputs and results   |
| Project files                            | Variables                   |
| Comments                                 | Input values you change     |
| Input blocks and their **Default value** | Your machine                |
| Integrations and machine settings        | Your runs and run snapshots |

Input values you change stay in your browser and aren't saved. When you open the notebook again, including after a reload, inputs start from their **Default value**, which editors set in the block sidebar.

<Callout status="warning">
Files are shared. A file your code saves to the project, such as a CSV or a chart image, is visible to everyone in the project. Keep personal results in memory or return them as outputs.
</Callout>

Workspace admins don't see other people's results either. People with view access, who can't run the notebook, see code only; share a [published app](/docs/data-apps) with them instead.

## Machines

Everyone runs on their own machine in a project that runs privately, and each app viewer session gets its own machine as well. The project's own machine doesn't run notebook code; it only hosts [Streamlit apps](#streamlit-apps).

Every machine uses the project's machine type and environment. Changes to the machine settings apply to everyone from their next machine start. Machine time is billed to the workspace in [machine hours](/docs/machine-hours).

## What isn't available

These features aren't available in a project that runs privately, because their results would reach other people:

- **[Agent blocks](/docs/deepnote-agent)** stop with a message when they run.
- **The Slack agent** refuses requests about the project, including reading its runs, because a Slack thread is shared. Slack notifications still link to the project.
- **The [terminal](/docs/terminal)** can't be opened.
- **Exporting a table as CSV** is refused, because the file would be saved to the shared project files.
- **[Modules](/docs/modules)** from a project that runs privately can't be imported into other notebooks.

Exports, duplicates, templates and [embedded blocks](/docs/sharing-and-embedding-blocks) work as usual, but carry code only: the project holds no shared results.

### Known limitations

- Connecting or disconnecting an integration can fail while a Streamlit app in the project is running. Stop the app and try again.

## Schedules, apps and history

- **[Scheduled runs](/docs/scheduling)** run on their owner's machine with the owner's credentials, and only the owner sees their results. The option to update the notebook with the run's results isn't available.
- **[Published apps](/docs/data-apps)** run in isolated mode: each viewer runs the app in their own session, with their own credentials, and sees only their own results.
- **Run history** shows each person only their own runs, including runs from before private outputs were turned on.
- **The History tab** shows who ran a notebook and when, never the results. **View run** is available only for your own runs.
- **[Version history](/docs/history)** keeps the code of every version. Viewing or restoring a version brings back its code without outputs.
- **The [audit log](/docs/audit-log)** records when private outputs are turned on in a project.

## Deepnote API and MCP

The [Deepnote API](/docs/deepnote-api) and [Deepnote MCP](/docs/deepnote-mcp) act as the person whose key or account calls them:

- Runs execute on the caller's own machine, and run lists and run reads return only the caller's runs.
- Checking, starting, stopping and restarting a machine act on the caller's own machine. See [Managing machines with the Deepnote API](/docs/deepnote-api-machines).
- The MCP `get_block` tool returns the caller's own outputs.

## Streamlit apps

A [Streamlit app](/docs/streamlit) in a project that runs privately runs on the project's machine, as one app server for all viewers. Each viewer queries data with their own credentials through [per-viewer authentication](/docs/streamlit#per-viewer-authentication-with-oauth-integrations). The app can't read notebook outputs, because the notebooks have no shared results.

Streamlit's cache is shared by every viewer of the app. If a cached result depends on the viewer's credentials, one viewer's data can be served to another. To keep each viewer's data their own:

- Give a cached function whose result depends on the viewer's credentials the viewer as an argument, so each viewer gets their own cache entry.
- Never cache a warehouse connection or client with `st.cache_resource`. Create it for each viewer.
- Keep per-viewer data in `st.session_state`, which belongs to one viewer's session.
