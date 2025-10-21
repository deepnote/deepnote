---
title: Data tables
description: Sort, filter, format, organize, and view tabular data
noIndex: false
noContent: false
---

<Embed url='https://www.loom.com/share/0538c44bf30a4098979f0fc31d1958ba'/>

Our Data table isn’t a separate block type, but a part of SQL and Code blocks used to display DataFrame contents.

The data table interface provides powerful tools to explore, analyze, and present your data. Through intuitive controls for sorting, filtering, cell formatting, and column customization, you can make your data easier to understand and highlight important bits.

<Callout status="info">
The manipulations we cover here don’t modify underlying data. So you can adjust the data table as you like without fear of messing up the original data.
</Callout>

## Preview

On some data tables, you can see the "Preview" badge. It indicates that only part of the data is available in the data table. Depending on the block type and badge appearance, this could be a data preview or query preview.

Data preview is used to display big DataFrames that are potentially too expensive to display fully in the data table. For example, data preview will be used for Spark DataFrames to avoid expensive materialization of the whole DataFrame.

![Data preview](https://media.graphassets.com/RBGpC1dtQ6ybM6HyDizw)

Query preview is used in the data table of the SQL block if you selected "Query preview" as output mode for the cell. In this mode, Deepnote loads a limited number of rows from the database and allows you to reuse the resulting DataFrame as part of a bigger query. Learn more about [query chaining](/docs/sql-cells#output-modes).

![Query preview](https://media.graphassets.com/noIvGM0HQ7q0oBDeUtzo)

## Sorting

To sort DataFrame rows by particular column, click on its name, and from the column menu, select if you want to sort ascending or descending.

<Callout status="info">
Clicked on column name, but got nothing? It seems you can’t modify this DataFrame. This might be the case for data tables in apps without the “Allow app to be run” setting enabled, or if the data table is inside an embedded cell.
</Callout>

<VideoLoop src="https://media.graphassets.com/K1ymyNmqTW2V5g1lGzlt" />

## Filtering

To filter your DataFrame, click on **Filter** in the column menu and fill in required data. Alternatively, you can use the **Filter button** from block actions.

If DataFrame has at least one filter applied to it, you’ll see a list of applied filters on top of the data table. From there, you can edit, remove, and add new filters.

<VideoLoop src="https://media.graphassets.com/rRUPVPP7QfW7gDSl3aaY" />

## Cell formatting

To make data easier to digest, you can highlight important bits with a pop of color. To open cell formatting configuration, click the **Format** button at the bottom of the data table.

Here you can select if you want to apply single color formatting to cells that match a certain condition or if you want to apply color scale to all cells in a column.

<VideoLoop src="https://media.graphassets.com/6qngCrpGQ4WvOa7DUyej" />

## Renaming column

To change column name, click **Rename** in the column menu and enter a new name. Pressing Enter will rename the column, and pressing Esc will cancel renaming.

For columns with a custom name, there will be a **Reset name** button in the column menu that restores the original column name.

<VideoLoop src="https://media.graphassets.com/GE4agCuMQcyD54NoOxYN" />

## Hiding column

In the same menu, you can click **Hide column** to hide it from the data table. To see a list of hidden columns, click on the **eye icon** in the top left corner of the data table. Clicking on a column in this list will make it visible again.

<VideoLoop src="https://media.graphassets.com/AylhYjQkQFCnMR8lOfQS" />

## Reordering columns

Columns can be rearranged just by dragging them around.

<VideoLoop src="https://media.graphassets.com/ugEACzBDQtSb5QyKGmdE" />

## Text wrap

By default, cells in the data table render data only in single line, so longer texts get trimmed. With **Wrap cells** enabled (you can find it in the column menu), text will be wrapped instead (up to 10 lines per cell).

<VideoLoop src="https://media.graphassets.com/tSoJC51fR5uJkdMRHpl7" />

## Copying cell content

You can always select a portion of text in a cell and press `Cmd + C` or `Ctrl + C` to copy it. To copy the whole content of the cell, you need to select it first by triple-clicking on it. Now, if you press `Cmd + C` or `Ctrl + C` (or use the context menu to copy), the whole content of the cell will be copied instead.

<VideoLoop src="https://media.graphassets.com/DnkXoyQRcKiRsd8FfMFP" />
