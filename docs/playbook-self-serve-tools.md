---
title: "Playbook: self-serve tools for non-technical teams"
description: Turn a notebook into a tool that sales, finance or operations can use on their own, with controls, sensible defaults, the right access level, enough compute and a way to see whether it's used
noIndex: false
noContent: false
---

Many requests to a data team are the same question with different parameters: "pipeline for EMEA this quarter", "churned accounts with more than 50 seats", "forecast if we hire two more people". Each one costs an analyst half an hour. A self-serve tool answers the whole family of questions once, and the person asking runs it themselves.

This playbook shows how to build that tool from a notebook and run it safely for a team that never opens the notebook itself.

## What you'll combine

| Feature                                                                           | Role in this playbook                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [Input blocks](/docs/input-blocks)                                                | The controls people use                                 |
| [Notebook apps](/docs/data-apps)                                                  | The interface, with the code hidden                     |
| [Team permissions](/docs/team-permissions)                                        | Who can use the tool and who can change it              |
| App compute settings                                                              | Enough machines for everyone using it at once           |
| [Scheduling](/docs/scheduling)                                                    | Precomputed results that open instantly                 |
| Per-user OAuth integrations                                                       | Each person sees only the data their own account allows |
| [Usage insights](/docs/app-and-notebook-analytics) and [comments](/docs/comments) | Whether people use it, and what they ask about          |

## Build the tool

### 1. Turn each parameter into an input

Replace every value you edit by hand when answering the request with an [input block](/docs/input-blocks):

| Parameter                                     | Input block                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Region, team, product, plan                   | Select. Use **From variable** to fill the options from a query, up to 1,000 values |
| Date or reporting period                      | Date or date range                                                                 |
| Threshold, headcount, growth rate             | Slider or text                                                                     |
| Include or exclude something                  | Checkbox                                                                           |
| A list someone pastes in, such as account IDs | Textarea                                                                           |
| A spreadsheet someone brings                  | File                                                                               |
| An explicit "go" step                         | Button                                                                             |

Give every input a default that produces a useful answer, so the tool works as soon as it opens. Reference inputs in SQL blocks with `{{ variable_name }}` and in Python by their variable name.

### 2. Lay out the app

Publish the notebook as an [app](/docs/data-apps):

1. Add the inputs, the headline numbers, one or two charts and the detailed table. Leave out exploration blocks.
2. Turn on **Hide code blocks**.
3. Put the inputs in a row at the top and the results below, or use columns with **Make app full-width**.
4. Add a text block that explains what the tool answers, where the data comes from, and who to ask for help.

### 3. Choose how it runs

In **App run settings**, choose **Auto-run dependent blocks**, the recommended setting. Changing an input reruns only the blocks that depend on it, so answers come back quickly. If people usually change several inputs before they want a result, choose one of the manual options instead, which wait for them to press a button.

If the tool takes more than a few seconds to answer and most people want the standard view, precompute it:

1. Schedule the notebook and turn on **Update notebook with run results**.
2. In **App data**, select **Show last run results**.

The app then opens with the latest scheduled results, and anyone who needs other parameters can still change the inputs and rerun. **Show last run results** isn't available in a project that runs privately, because there each viewer sees only their own runs.

### 4. Share links that answer a specific question

An app's URL can carry input values. Add `__run=true` and the app runs as soon as it opens:

```
https://deepnote.com/app/your-workspace/Pipeline-review-<id>/?region=EMEA&quarter=2026-Q4&__run=true
```

Put links like this in a weekly email, a CRM record or a wiki page, so people land directly on the answer they need.

## Run it for a team

### Give people the right access

| Who                                       | Access                                                                | What they can do                           |
| ----------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| Business users                            | **App user** on the project                                           | Open and run the app, but not the notebook |
| The analysts who maintain the tool        | **Edit**                                                              | Change the notebook and the app            |
| Contractors or partners in your workspace | The **Restricted user** workspace role, plus App user on this project | Use only the projects shared with them     |

Restricted users see only projects shared with them directly, and can't duplicate or delete those projects or change their settings, even with higher project access. People outside your workspace who are invited to a single project appear as guests.

Every viewer's runs are independent: one person changing an input doesn't change what anyone else sees.

### Give it enough compute

By default, every viewer's run uses the project's machine. That's the fastest to start, and fine for a handful of users. For a tool many people use at the same time, open **App compute** and choose **Dedicated machine per session**. Each viewer session then gets its own machine, which stops after an idle timeout you choose: 5, 15, 30 or 60 minutes. To control cost, cap the number of concurrent sessions at 5, 10, 25 or 50.

### Keep each person to their own data

If the tool queries Snowflake or BigQuery through an integration that uses per-user OAuth, each viewer signs in with their own account the first time they run the app and sees only what that account can access. One tool can then serve every region or team without separate copies. See [Snowflake OAuth](/docs/snowflake-oauth) and [BigQuery with Google OAuth](/docs/bigquery-oauth).

With an integration that uses shared credentials, every viewer queries with the integration's credentials. Filter by the viewer's input values only when every viewer is allowed to see all of the data.

### Let people download results

Write the result to a file in the project, for example `export.csv`, and link to it from a text block in the app with `https://deepnote.com/publish/<project_id>/file?path=export.csv`. See [Letting users download files](/docs/data-apps#letting-users-download-files-from-the-project-filesystem).

## Keep it useful

- **Collect questions in place.** Turn on **Allow comments** in the app settings so that people ask next to the number they're asking about.
- **Watch usage.** [Usage insights](/docs/app-and-notebook-analytics) show who viewed and who ran the app. A tool nobody has run in a month is a candidate for retirement.
- **Change it safely.** For larger changes, work in a copy of the notebook and publish the copy when it's ready. The app link stays the same. See [Live updates](/docs/data-apps#live-updates).

## Plan requirements

- **Notebook apps and input blocks:** all plans.
- **App user access for individual people, scheduling, and dedicated machines per session:** Team and Enterprise.
- **Per-user OAuth integrations:** Enterprise.

## Variations

- **Sales:** a territory review tool with region and quarter inputs, linked from each account executive's CRM dashboard with the inputs already filled in.
- **Finance:** a headcount planning model where sliders for hiring plan and salary growth feed a forecast chart, precomputed nightly with the approved plan.
- **Customer success:** paste a list of account IDs into a textarea and get health scores and renewal dates, with per-user OAuth so each manager sees only their own accounts.

## Related

- [Choosing how to build an app](/docs/playbook-choosing-an-app-type)
- [Data apps](/docs/data-apps)
