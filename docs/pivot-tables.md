---
title: Pivot tables
noIndex: false
noContent: false
---

<Callout status="info">
Pivot table blocks are in beta. This is an early version, so expect it to change, and tell us what you'd like it to do.
</Callout>

A pivot table block summarizes and cross-tabulates a DataFrame without any code. You choose the fields to group by and the value to aggregate, and Deepnote builds the summary for you.

## Adding a pivot table block

Add a pivot table block from the **+** (add block) menu or the block bar at the bottom of the notebook, then point it at a DataFrame produced earlier in the notebook (from a Python or SQL block).

## Configuring the summary

A pivot table has three inputs:

- **Rows**: The field(s) whose values form the rows of the summary.
- **Columns**: The field(s) whose values spread across the columns. Leave this empty for a simple grouped summary.
- **Aggregation**: The field to aggregate, together with an aggregation: count, count unique, sum, average, median, min, or max.

Adjust any of these and the block recomputes the result.

## Working with the result

The result renders as a standard [data table](/docs/data-tables), so you can sort, filter, and format it like any other block output and reuse it in the blocks that follow.
