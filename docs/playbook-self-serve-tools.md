---
title: "Playbook: self-serve tools for non-technical teams"
description: Build a data app that sales, finance or operations can use on their own, with controls, sensible defaults and the right access level, so the same question stops coming back to the data team
noIndex: false
noContent: false
---

Many requests to a data team are the same question with different parameters: "pipeline for EMEA this quarter", "churned accounts with more than 50 seats", "forecast if we hire two more people". Each one costs an analyst half an hour. A self-serve tool answers the whole family of questions once, and the person asking runs it themselves.

This playbook shows how to build that tool from a notebook and run it safely for a team that never opens the notebook itself.

## What you'll combine

| Feature                                      | Role in this playbook                                   |
| -------------------------------------------- | ------------------------------------------------------- |
| [Data app projects](/docs/data-app-projects) | The tool people open, built by Deepnote Agent           |
| [Input blocks](/docs/input-blocks)           | The controls people use                                 |
| [Team permissions](/docs/team-permissions)   | Who can use the tool and who can change it              |
| Per-user OAuth integrations                  | Each person sees only the data their own account allows |

## Build the tool

### 1. Describe it to Deepnote Agent

Click **Create new** in your workspace and choose **New data app**. Describe the question the tool answers, the values people change, the headline numbers, one or two charts and the detailed table, for example _"Pipeline by region and quarter, with total open value, a chart by stage and the 20 largest open deals."_ Ask for a short note on the page that says where the data comes from and who to ask for help.

The agent builds the page and the notebook behind it. Keep asking for changes until it's right.

### 2. Check the inputs

The app's controls are the notebook's [input blocks](/docs/input-blocks). Click **Show notebook** and check that every value people change has one, with a default that gives a useful answer:

| Parameter                                     | Input block        |
| --------------------------------------------- | ------------------ |
| Region, team, product, plan                   | Select             |
| Date or reporting period                      | Date or date range |
| Threshold, headcount, growth rate             | Slider or text     |
| Include or exclude something                  | Checkbox           |
| A list someone pastes in, such as account IDs | Textarea           |

Reference inputs in SQL blocks with `{{ variable_name }}` and in Python by their variable name.

### 3. Keep it fast

When someone submits the inputs, the whole notebook runs for them on a new machine with the project's machine type. Nobody waits for anyone else, but every answer includes the time a machine takes to start. Query only what the app shows, and aggregate in the warehouse rather than in Python.

There are no shared, precomputed results: each viewer sees their own latest run, kept for your plan's run retention. If many people ask the same few questions and need answers instantly, a [Streamlit app project](/docs/streamlit-app-projects) can cache results for every viewer. Cache only results every viewer may see: a shared `st.cache_data` entry doesn't distinguish viewers, so it would hand one person's per-user OAuth results to the next.

### 4. Send links that answer a specific question

The app's link can carry query parameters, and the page can read them. Ask the agent to fill the inputs from the link, for example `?region=EMEA&quarter=2026-Q4`, then put links like this in a weekly email, a CRM record or a wiki page.

## Run it for a team

### Publish it and give people the right access

A new data app is unpublished, so only the project's editors can open it. Click **Share**, set the app to **Published**, invite the people who should use it, and send them the link from **Copy link to app**. Published apps open only when **Allow static file sharing in projects** is on in **Settings & members → Project settings**, so check that first.

| Who                                       | Access                                                                                | What they can do                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Business users                            | **App user** on the project, and no higher access through workspace access or a group | Open and run the app, but not the notebook or its code |
| The analysts who maintain the tool        | **Edit**                                                                              | Change the app and the notebook, and use the agent     |
| Contractors or partners in your workspace | The **Restricted user** workspace role, plus App user on this project                 | Use only the projects shared with them                 |

Restricted users see only projects shared with them, and can't duplicate or delete those projects or change their settings, even with higher project access. People outside your workspace who are invited to the project appear as guests. Data apps can't be shared with anyone who has the link.

App users can't open the notebook or its code. The app's own HTML and scripts are sent to their browser like any web page, so keep nothing secret in them.

Every viewer's runs are independent: one person changing an input doesn't change what anyone else sees.

### Keep each person to their own data

If the tool queries Snowflake or BigQuery through an integration that uses per-user OAuth, each viewer's run queries with their own account and sees only what that account can access. One tool can then serve every region or team without separate copies. See [Snowflake OAuth](/docs/snowflake-oauth) and [BigQuery with Google OAuth](/docs/bigquery-oauth).

With an integration that uses shared credentials, every viewer queries with the integration's credentials. App users can read every output of their own runs through the app's API access, not only what the page shows. Filter by the viewer's input values only when every viewer may see all of the data, and keep anything they may not see out of the notebook's outputs.

If the notebook imports [modules](/docs/modules), each viewer's run imports them as that viewer, so viewers need at least Execute access to the modules' projects. That access also lets them open those projects, so keep modules the app's viewers shouldn't read in a project of their own.

### Let people download results

A data app can't serve files from viewers' runs. Ask the agent to add a download button that builds a CSV from the data the page already shows.

## Keep it useful

- **Watch usage.** Viewers' runs appear as detached runs in the notebook's [usage insights](/docs/app-and-notebook-analytics), under **All**. A tool nobody has run in a month is a candidate for retirement.
- **Change it safely.** Changes go live as soon as the agent saves them. For larger changes, set the app to **Unpublished** while you work, so only editors can open it.

## Plan requirements

- **Data app projects and input blocks:** all plans.
- **App user access for individual people:** Pro, Team and Enterprise.
- **Per-user OAuth integrations:** Enterprise.

## Variations

- **Sales:** a territory review tool with region and quarter inputs, linked from each account executive's CRM dashboard with the inputs filled in from the link.
- **Finance:** a headcount planning model where sliders for hiring plan and salary growth feed a forecast chart.
- **Customer success:** paste a list of account IDs into a textarea and get health scores and renewal dates, with per-user OAuth so each manager sees only their own accounts.

## Related

- [Choosing how to build an app](/docs/playbook-choosing-an-app-type)
- [Data app projects](/docs/data-app-projects)
