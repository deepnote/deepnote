---
title: "Playbook: choosing how to build an app"
description: Compare data app projects and Streamlit app projects, see when to embed a block or call the API instead, and pick the right way to put an analysis in front of other people
noIndex: false
noContent: false
---

Deepnote has two kinds of app project for putting an analysis in front of other people: data app projects and Streamlit app projects. Both are built by chatting with [Deepnote Agent](/docs/deepnote-agent), both keep the queries in a notebook, and both are shared only with people who have access to the project. This page compares them, and covers what to use when the numbers have to appear somewhere else.

## The options

| Option                                                       | What you build                                                   | Who builds it                      | Best for                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| [Data app project](/docs/data-app-projects) (beta)           | An HTML page backed by one notebook                              | Deepnote Agent, from a description | Dashboards and self-serve tools with a polished interface   |
| [Streamlit app project](/docs/streamlit-app-projects) (beta) | A Streamlit app in `app.py`, hosted by Deepnote, with a notebook | Deepnote Agent, or you in Python   | Python-heavy interactive tools                              |
| [Embedded blocks](/docs/sharing-and-embedding-blocks)        | Single charts or tables placed in another tool                   | Anyone who can edit the notebook   | Live numbers inside Notion, Confluence or a website         |
| [Deepnote API](/docs/deepnote-api)                           | Your own product or service calling a notebook                   | Developers                         | Showing a notebook's results inside an app you already have |

## How to choose

**Start with a data app project.** Describe the dashboard or tool, and Deepnote Agent builds the page and the notebook behind it. The page's controls are the notebook's [input blocks](/docs/input-blocks), and each viewer runs the notebook with their own values.

Then:

- **The tool is mostly Python logic with many interactions.** A Streamlit app project gives you Streamlit's components and session state, written in `app.py` by you or the agent.
- **Many people ask the same few questions and want answers instantly.** A Streamlit app can cache results for every viewer with `st.cache_data`. A data app keeps no shared results: each viewer gets an answer only once they've run the notebook themselves, and sees their own last run until they run it again.
- **The numbers need to live in another tool.** Embed the block in Notion, Confluence or a website. Data apps can't be embedded in other sites.
- **Your own product shows the result.** Call the notebook from your server with the [Deepnote API](/docs/deepnote-api). See [A notebook as a backend](/docs/playbook-notebook-as-a-backend).
- **Viewers must not open the notebook.** Share the project with them at **App user** access, which lets them use the app without seeing the notebook or the app's code. A person gets the most permissive of all their grants, so App user only works if workspace access, groups and direct sharing don't give them more. App users can still read every output of their own runs through the app's API access, not only what the page shows, so keep anything a viewer may not see out of the notebook's outputs. Keep secrets in integrations and environment variables, never in the app's code.

## What they have in common

- **Access.** Both are shared with people who have access to the project: **App user** can use the app, **View** can also open the notebook and the app's code, and **Edit** can change them. People outside the workspace can use an app once they're invited to the project and signed in. A data app can go further and be [made public](/docs/data-app-projects#sharing-an-app-publicly), so anyone with its link can open it without a Deepnote account; a Streamlit app can't be shared by link at all.
- **Integrations.** Queries run against the integrations connected to the project, and credentials stay on the server. With integrations that use per-user OAuth, such as [Snowflake OAuth](/docs/snowflake-oauth) or [BigQuery with Google OAuth](/docs/bigquery-oauth), queries run with each viewer's own account. Embedded blocks are different: they show the block's saved output to anyone with the link, without querying again as the viewer.
- **Built with the agent.** Deepnote Agent writes both, checks them for errors and fixes what it finds. You refine them in chat.

## Where they differ

|                               | Data app project                                                                | Streamlit app project                                                           |
| ----------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Where it runs                 | A new machine for each viewer's run, with the project's machine type            | One app server on the project's machine, shared by every viewer                 |
| What a viewer sees on opening | The results of their own latest run, or a prompt to run the notebook            | The app, running                                                                |
| How it reads data             | Runs the whole notebook as the viewer and shows the notebook's JSON output      | Python in `app.py` queries the integrations, or runs the notebook as the viewer |
| How long results last         | Each viewer's latest results, for your plan's run retention (1, 30 or 365 days) | What the app keeps in session state or its cache                                |
| Publishing                    | Unpublished until an editor sets it to **Published**                            | Available to everyone with access as soon as it runs                            |
| Sharing by link               | Can be made public by a project admin, on Team and Enterprise                   | Not available: viewers need project access                                      |

## Example

The [Lindquett Software example](https://github.com/deepnote/deepnote/tree/main/examples/lindquett-software) has both kinds. Four tools are data apps, HTML pages that run
their notebook for each viewer. The [pricing scenario planner](https://github.com/deepnote/deepnote/tree/main/examples/lindquett-software/pricing-planner) is a Streamlit app:
a scheduled notebook writes the pricing baseline once a day, and the app models price changes on it
with no notebook run per slider move.

When the page itself is the point, a data app's page is just HTML, so you can write it by hand instead of
asking the agent for it. The three public-data apps in
[`examples/data-apps`](https://github.com/deepnote/deepnote/tree/main/examples/data-apps) — a globe of the
world's shipping lanes, a season of nightly bird migration over Europe, and the coastline paradox on nine
Greek islands — are built that way: a custom page, with the notebook behind it preparing the data.

## Plan requirements

- **Data app projects, Streamlit app projects and embedded blocks:** all plans.
- **App user access for individual people:** Pro, Team and Enterprise.
- **Per-user OAuth integrations:** Enterprise.

## Related

- [Data app projects](/docs/data-app-projects)
- [Streamlit app projects](/docs/streamlit-app-projects)
- [Self-serve tools for non-technical teams](/docs/playbook-self-serve-tools)
- [Sharing and embedding blocks](/docs/sharing-and-embedding-blocks)
