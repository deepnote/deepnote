---
title: Run snapshots
description: Every notebook run creates an immutable snapshot you can review anytime
noIndex: false
noContent: false
---

Every time you run a notebook, Deepnote automatically creates an immutable **run snapshot** — a frozen record of the notebook's state at the moment the run completed. You can revisit any past run to see exactly what happened, without re-executing.

## What's captured

Each snapshot includes:

- **All blocks and outputs** — the full notebook content as it appeared after execution
- **Execution metadata** — who triggered the run, when it started and finished, and how it was triggered (manually, via [schedule](/docs/scheduling), or through the [API](/docs/deepnote-api))
- **Execution summary** — total block count, how many succeeded or failed, and overall duration

<Callout status="info">
Snapshots are read-only. They capture the notebook state at execution time and cannot be edited.
</Callout>

## Where to find snapshots

You can access run snapshots from three places:

- **Runs sidebar** — click **Runs** in the project top bar to open a sidebar listing recent runs with status indicators. Click any run to view its snapshot.
- **Project logs** — the history tab shows past executions. Runs with available snapshots display a **View run** button.
- **Logs & Analytics modal** — open the project top bar context menu and select **View analytics** to see execution history alongside snapshot access.

![Runs sidebar showing recent run snapshots](../assets/docs/run-snapshots/run-snapshots-sidebar.webp)

When you open a run, Deepnote displays the immutable snapshot in a modal so you can inspect the notebook exactly as it looked when that execution finished.

![Run snapshot modal showing a completed notebook execution](../assets/docs/run-snapshots/run-snapshot-modal.webp)

## Use cases

- **Debug failed scheduled runs** — see exactly what happened when a notebook failed overnight, including which block errored and what the outputs looked like before the failure
- **Audit trail** — review who ran what and when, with full output history, across manual, scheduled, and API-triggered runs
- **Collaboration** — point teammates to a specific run's results instead of asking them to re-execute
