---
title: "Playbook: reports that deliver themselves"
description: Build a recurring report once in Deepnote and let a schedule refresh it, update its app and embedded charts, notify readers, keep an archive of past editions and show who reads it
noIndex: false
noContent: false
---

A weekly report often costs someone a morning: run the notebook, check the numbers, export the charts, paste them into a document and send it round. Every step except checking the numbers can be automated in Deepnote, and the result is better for readers: the numbers are always current, past editions are kept for your plan's snapshot retention period, and you can see whether anyone reads it.

## What you'll combine

| Feature                                               | Role in this playbook                          |
| ----------------------------------------------------- | ---------------------------------------------- |
| [Modules](/docs/modules)                              | The metric definitions the report uses         |
| [Scheduling](/docs/scheduling)                        | Refreshes the report                           |
| [Notebook apps](/docs/data-apps)                      | The report readers open                        |
| [Embedded blocks](/docs/sharing-and-embedding-blocks) | Live charts in Notion, Confluence or your wiki |
| Schedule notifications                                | Tell readers a new edition is ready            |
| [Run snapshots](/docs/run-snapshots)                  | An archive of every edition                    |
| [Usage insights](/docs/app-and-notebook-analytics)    | Who reads the report                           |

## 1. Build the report

- **Use shared definitions.** Import metrics from [modules](/docs/modules) rather than writing the queries again, so the report agrees with every other dashboard.
- **Lead with the headline.** Start with a few big numbers, then the charts that explain them, then detail tables.
- **Write the commentary in text blocks.** Use them to explain what changed and why. An [agent block](/docs/deepnote-agent) can also write a short summary of the latest numbers on each run.
- **Make the period an input.** A date or date range input with a default of "last week" lets the same notebook produce past editions when someone needs one.

## 2. Publish it as an app

Publish the notebook as an [app](/docs/data-apps), hide the code, and in **App data** select **Show last run results**. Readers then open the app and see the latest edition immediately, without waiting for queries to run. **Show last run results** isn't available in a project that runs privately, so keep the report in a project that doesn't.

If readers shouldn't change anything, turn off **Allow app to be run**. Leave it on if they may change the inputs to look at another period or region.

## 3. Schedule it

[Schedule](/docs/scheduling) the notebook, for example every Monday at 07:00 in your readers' time zone, and turn on **Update notebook with run results**. After each successful run:

- The notebook's outputs are replaced with the new results.
- The app shows the new edition, because it shows the last run.
- [Embedded blocks](/docs/sharing-and-embedding-blocks) in Notion, Confluence or any page that accepts an iframe update too, because embeds follow the notebook.

With **Update notebook with run results** turned off, the notebook and its app stay unchanged and each run's results are only in the run history.

## 4. Tell readers it's ready

Add **success** notifications to the schedule:

- **Slack channels** suit a team or company-wide audience.
- **Email** goes to members of your workspace. When the scheduled notebook is the one published as the app, the email links straight to the app. The app always shows the latest edition, so an old email opens the current one.

Add a **failure** notification for the report's owner, so a broken edition is noticed before readers notice it.

## 5. Keep an archive

Every scheduled run creates a [run snapshot](/docs/run-snapshots): an unchangeable record of the notebook and its outputs after that run, with its own link. Past editions stay as they were sent, even after definitions or data change. Find snapshots in the **Runs** sidebar or the project log. Snapshots belong to the project and show the whole notebook, so readers with only **App user** access can't open them. For those readers, have the notebook write each edition's key numbers to a table and show that history in the app, for example as a chart of past editions.

Snapshots are kept for 30 days on Team and 365 days on Enterprise. To keep editions longer, download the snapshot from the run, or have the notebook write each edition's key numbers to a table in your warehouse.

## 6. Check whether it's read

[Usage insights](/docs/app-and-notebook-analytics) show who viewed the app and who ran it. Readers who aren't signed in appear as anonymous, counted once per session. If a report hasn't been opened for a month, ask whether it's still needed before you maintain it for another quarter.

## Share it with the right people

- **Inside the workspace:** share the project with readers at **App user** access, so they can use the app without seeing the notebook.
- **Outside the workspace:** notebook apps can be shared with anyone who has the link or made public, unless an admin has turned off public app sharing. Embedded blocks are visible to anyone with the link, so embed only what may be shared that widely. Hidden blocks in a shared app aren't protected either: their content stays reachable for the app's viewers, so move sensitive work to another notebook before sharing.
- **Each reader's own data:** with per-user OAuth integrations (Enterprise), each reader sees only the data their own account allows when they run the app. A scheduled edition, though, runs as the schedule's owner with their access, and readers of **Show last run results** see that edition.

## Plan requirements

- **Notebook apps and embedded blocks:** all plans.
- **Scheduling and App user access for individual people:** Team and Enterprise.
- **Run snapshot retention:** 30 days on Team, 365 days on Enterprise.
- **Per-user OAuth integrations:** Enterprise.

## Variations

- **Weekly business review:** a company-wide app refreshed every Monday morning, announced in a leadership Slack channel.
- **Live numbers in planning documents:** embed the two or three charts a planning document relies on, so the document never goes stale.
- **Per-region editions:** one notebook with a region input, published as one app. Send each region a link with its region already filled in, such as `?region=EMEA&__run=true`.
