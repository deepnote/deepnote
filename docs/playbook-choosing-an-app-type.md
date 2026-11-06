---
title: "Playbook: choosing how to build an app"
description: Compare Deepnote's ways of putting an analysis in front of other people, from notebook apps and embedded blocks to data app projects, Streamlit apps and custom front ends, and pick the right one
noIndex: false
noContent: false
---

Deepnote has several ways to turn an analysis into something other people use. They overlap, and the right choice depends on who the audience is, how much interaction they need, and whether you want to write front-end code. This page compares them and suggests where to start.

## The options

| Option                                                       | What you build                                                      | Who builds it                      | Best for                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| [Notebook app](/docs/data-apps)                              | A layout of a notebook's blocks, inputs, charts and tables          | Anyone who can edit the notebook   | Dashboards, reports and parameterized tools, built in minutes  |
| [Embedded blocks](/docs/sharing-and-embedding-blocks)        | Single charts or tables placed in another tool                      | Anyone who can edit the notebook   | Live numbers inside Notion, Confluence or a website            |
| [Data app project](/docs/data-app-projects) (beta)           | A custom HTML page backed by a notebook                             | Deepnote Agent, from a description | A polished, branded tool without writing front-end code        |
| [Streamlit app project](/docs/streamlit-app-projects) (beta) | A Streamlit app hosted by Deepnote                                  | Deepnote Agent, or you in Python   | Python-heavy interactive tools                                 |
| [Static site with the CLI](/docs/deepnote-cli-publish)       | Your own front end, for example a Vite build, published to Deepnote | Front-end developers               | Full control over the interface, with notebooks as the backend |

## How to choose

**Start with a notebook app.** It's the fastest route and covers most needs: inputs become controls, charts and tables keep their interactivity, and you can arrange blocks in columns. Move to another option only when you hit a specific limit.

Then:

- **The numbers need to live in another tool.** Embed the block, or embed the whole app with an iframe. Both stay up to date with the notebook.
- **The interface has to look like your product or brand.** Use a data app project and describe the design to Deepnote Agent, or publish your own front end with the CLI if your team already writes JavaScript.
- **The tool is mostly Python logic with many interactions.** A Streamlit app project gives you Streamlit's component library and session state.
- **Viewers must not open the project.** Share it with them at the **App user** access level, which lets people use the published app without opening the notebook. A person gets the most permissive of all their grants, so App user only works if the project's workspace access and link sharing don't give them more; check the access they actually have. This controls access to the project, not what the app itself serves: **Hide code blocks** only changes how a notebook app looks, and the content of hidden blocks stays reachable for anyone who can open the app. A static site's files, including its JavaScript, are sent to every viewer's browser. Keep secrets in integrations and environment variables, never in code an app shows or ships.

## What they have in common

All options run on Deepnote, so they share the same controls:

- **Permissions.** People you share a project with get an access level from **App user**, which can only use the published app, up to **Full access**. App users can't open the notebook.
- **Integrations.** Queries run against the integrations connected to the project, and credentials stay on the server. With integrations that use per-user OAuth, such as [Snowflake OAuth](/docs/snowflake-oauth) or [BigQuery with Google OAuth](/docs/bigquery-oauth), each viewer signs in and sees only the data their own account allows when they run the app. Embedded blocks are different: they show the block's saved output to anyone with the link, without querying again as the viewer.
- **Usage analytics.** [Usage insights](/docs/app-and-notebook-analytics) show who viewed and ran an app, so you can tell which tools are used and retire the rest.

## Where they differ

|                               | Notebook app                                         | Data app project                                                  | Streamlit app project                          | Static site with the CLI                                                                     |
| ----------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Sharing beyond the project    | Same as the project, anyone with the link, or public | Only people with access to the project                            | Only people with access to the project         | Only people with access to the project                                                       |
| What a viewer sees on opening | Empty outputs, or the last notebook run              | Their own latest run                                              | The app, running for them                      | Your page                                                                                    |
| How it reads data             | Runs the notebook's blocks                           | Runs the notebook and passes results to the page                  | Runs Python against the project's integrations | Calls the Deepnote API with a short-lived viewer token, if API access is enabled for the app |
| Plan                          | All plans                                            | Team and Enterprise, because publishing needs static file sharing | All plans                                      | Team and Enterprise, because it needs static file sharing                                    |

## Notebook app settings that matter

The [data apps page](/docs/data-apps) covers every setting. These are the ones that most change how an app behaves:

- **App run settings.** **Auto-run dependent blocks**, the recommended setting, reruns only the blocks affected by an input change. The first run in a session, and any run after 10 minutes without activity, still runs every block. The manual options wait for a button press, which suits apps where people set several inputs before running.
- **App data.** **Run app from scratch** starts with empty outputs. **Show last run results** shows the last notebook run. Combined with a schedule that has **Update notebook with run results** turned on, this gives you a precomputed dashboard that opens instantly. Every viewer sees that run's output, and the last run can also be a manual run by an editor, using their credentials. Keep every output in the notebook suitable for all viewers.
- **App compute.** **Shared project machine** runs every viewer on the project's machine and starts fastest. **Dedicated machine per session**, on Team and Enterprise, gives each viewer session its own machine that stops after an idle timeout of 5, 15, 30 or 60 minutes. You can cap concurrent sessions at 5, 10, 25 or 50, or leave them unlimited. Apps that contain an agent block always use dedicated machines. In a project that runs privately, each viewer always gets a dedicated machine and sees only their own results, so **Shared project machine** and **Show last run results** aren't available there.
- **Allow app to be run.** Turn it off for a read-only report.
- **Allow comments.** Lets viewers ask questions next to the result.

## Plan requirements

- **Notebook apps and embedded blocks:** all plans.
- **App user access for individual people, and dedicated machines per session:** Team and Enterprise.
- **Turning off public app sharing for the workspace:** Team and Enterprise, under **Allow apps to be shared publicly** in the workspace security settings.
- **Data app projects and static sites:** Team and Enterprise, because both need static file sharing.
- **Streamlit app projects:** all plans.
- **Per-user OAuth integrations:** Enterprise.

## Related

- [Self-serve tools for non-technical teams](/docs/playbook-self-serve-tools)
- [Streamlit in Deepnote](/docs/streamlit)
- [Input blocks](/docs/input-blocks)
