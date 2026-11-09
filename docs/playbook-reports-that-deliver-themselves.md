---
title: "Playbook: reports that deliver themselves"
description: Build a recurring report once in Deepnote and let a schedule refresh it, update its embedded charts, notify readers, keep an archive of past editions and show who reads it
noIndex: false
noContent: false
---

A weekly report often costs someone a morning: run the notebook, check the numbers, export the charts, paste them into a document and send it round. Every step except checking the numbers can be automated in Deepnote, and the result is better for readers: the numbers are always current, past editions are kept for your plan's snapshot retention period, and you can see whether anyone reads it.

## What you'll combine

| Feature                                               | Role in this playbook                          |
| ----------------------------------------------------- | ---------------------------------------------- |
| [Modules](/docs/modules)                              | The metric definitions the report uses         |
| [Scheduling](/docs/scheduling)                        | Refreshes the report                           |
| [Data app projects](/docs/data-app-projects)          | Let readers run the report for their own slice |
| [Embedded blocks](/docs/sharing-and-embedding-blocks) | Live charts in Notion, Confluence or your wiki |
| Schedule notifications                                | Tell readers a new edition is ready            |
| [Run snapshots](/docs/run-snapshots)                  | An archive of every edition                    |
| [Usage insights](/docs/app-and-notebook-analytics)    | Who reads the report                           |

## 1. Build the report

- **Use shared definitions.** Import metrics from [modules](/docs/modules) rather than writing the queries again, so the report agrees with every other dashboard.
- **Lead with the headline.** Start with a few big numbers, then the charts that explain them, then detail tables.
- **Write the commentary in text blocks.** Use them to explain what changed and why. An [agent block](/docs/deepnote-agent) can also write a short summary of the latest numbers on each run.
- **Make the period an input.** A date or date range input with a default of "last week" lets the same notebook produce past editions when someone needs one.

## 2. Decide where readers read it

The schedule updates the notebook's outputs, so put the report where those outputs show:

- **In the tools readers already use.** [Embed](/docs/sharing-and-embedding-blocks) the headline numbers and charts in Notion, Confluence or your wiki. Embedded blocks show the notebook's latest outputs, so they update after each scheduled run.
- **In Deepnote.** Share the project with readers at **View** access. They open the notebook and see the latest edition, along with its code. Keep the report in a project that doesn't run privately, so everyone sees the same outputs.
- **For their own slice.** If readers want another period or region, build a [data app project](/docs/data-app-projects) on the same definitions, with the period and region as inputs. Each reader runs it for their own values and sees only their own results, so it answers follow-up questions rather than replacing the weekly edition. If its notebook imports metric [modules](/docs/modules), each reader needs Execute access to the modules' projects, and a module in a private project runs only for that project's owner.

A manual run of the report notebook replaces the outputs readers see, so do exploratory runs in a copy of the notebook, and rerun the report if someone changes it by hand.

## 3. Schedule it

[Schedule](/docs/scheduling) the notebook, for example every Monday at 07:00 in your readers' time zone, and turn on **Update notebook with run results**. After each successful run:

- The notebook's outputs are replaced with the new results.
- [Embedded blocks](/docs/sharing-and-embedding-blocks) in Notion, Confluence or any page that accepts an iframe update too, because embeds follow the notebook.

With **Update notebook with run results** turned off, the notebook and its embedded blocks stay unchanged and each run's results are only in the run history.

## 4. Tell readers it's ready

Add **success** notifications to the schedule:

- **Slack channels** suit a team or company-wide audience.
- **Email** goes to members of your workspace and links to the project, which shows the latest edition, so an old email opens the current one.

Add a **failure** notification for the report's owner, so a broken edition is noticed before readers notice it.

## 5. Keep an archive

Every scheduled run creates a [run snapshot](/docs/run-snapshots): an unchangeable record of the notebook and its outputs after that run, with its own link. Past editions stay as they were sent, even after definitions or data change. Find snapshots in the **Runs** sidebar or the project log. Snapshots belong to the project and show the whole notebook, including its code. To show readers a history of editions, have the notebook write each edition's key numbers to a table and chart them in the report.

Snapshots are kept for 30 days on Team and 365 days on Enterprise. To keep editions longer, download the snapshot from the run, or have the notebook write each edition's key numbers to a table in your warehouse.

## 6. Check whether it's read

[Usage insights](/docs/app-and-notebook-analytics) show who opened the notebook. If a report hasn't been opened for a month, ask whether it's still needed before you maintain it for another quarter.

## Share it with the right people

- **Inside the workspace:** share the project with readers at **View** access, or embed the report's blocks where they already read.
- **Outside the workspace:** embedded blocks are visible to anyone with the link, so embed only what may be shared that widely. A data app can be shared only with people invited to its project.
- **Each reader's own data:** a scheduled edition runs as the schedule's owner with their access, and everyone who reads the notebook or its embedded blocks sees that edition. With per-user OAuth integrations (Enterprise), a data app runs with each reader's own account instead. A module block queries its own project's integrations, so check those too: one that uses shared credentials returns the same data to every reader.

## Example

The [Revenue review app](https://github.com/deepnote/deepnote/tree/main/examples/lindquett-software/revenue-review) in the Lindquett Software example is a quarterly revenue
report built on metric modules. Scheduled every Monday, it opens on fresh numbers and an analyst note an
agent block wrote from the same definitions, and its filters live in the URL, so a link can open the
report on one region and quarter.

## Plan requirements

- **Embedded blocks and data app projects:** all plans.
- **Scheduling:** Pro, Team and Enterprise.
- **Run snapshot retention:** 30 days on Team, 365 days on Enterprise.
- **Per-user OAuth integrations:** Enterprise.

## Variations

- **Weekly business review:** a company-wide report refreshed every Monday morning, with its charts embedded in the leadership wiki and announced in a leadership Slack channel.
- **Live numbers in planning documents:** embed the two or three charts a planning document relies on, so the document never goes stale.
- **Per-region questions:** a data app on the same modules with a region input, so each region's lead can run the numbers for their region between editions.
