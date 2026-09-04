---
title: First steps
description: You want to get up and running right away, so let's cover the basics - Connecting to data, inviting team members, and analyzing data.
noIndex: false
noContent: false
---

## **Connecting to your data**

Deepnote integrates with all major data warehouses and databases, as well as common file storage services. Dropping a CSV straight into the notebook also works like a charm.

### Working with a CSV

To work with a CSV, simply drag it onto the notebook.

![CSV file dragged into a Deepnote notebook](../assets/docs/deepnote-first-steps/csv-drag-to-notebook.webp)

An SQL block with a sample query will be created for you and the file will be uploaded to Deepnote's file system. The results are saved to a Pandas DataFrame.

![CSV file linked to a generated SQL block](../assets/docs/deepnote-first-steps/csv-file-sql-insert.webp)

Pandas can also be used to read the uploaded CSV into the notebook's memory.

![Pandas loading an uploaded CSV into a DataFrame](../assets/docs/deepnote-first-steps/python-csv-dataframe.webp)

### Connecting to a database

In the notebook's right sidebar, click the **+** button next to **Integrations**.

Choose the database integration you want (e.g., Snowflake, BigQuery, PostgreSQL). You'll be asked to add your credentials.

![Integration chooser in the notebook sidebar](../assets/docs/deepnote-first-steps/notebook-integration-chooser.webp)

Once you've connected the database to a project (It'll appear in your sidebar), you can click it to preview its schema and use SQL blocks to query your data. The results are saved to a Pandas DataFrame.

![Database schema and SQL query results](../assets/docs/deepnote-first-steps/database-schema-query.webp)

## Inviting your team members

It's dangerous to go alone. Take this link.

### Links, email invites, and business domains

From the **Settings & members** section in the left-hand panel, you'll find links that you can send to your team in order to invite them to the workspace.

![Workspace members and invitation settings](../assets/docs/deepnote-first-steps/workspace-members.webp)

Different links provide different access controls.

![Workspace invite link options](../assets/docs/deepnote-first-steps/workspace-invite-links.webp)

Alternatively, you may enter email addresses and assign access controls that way (note the toggle switch that allows anyone with your business domain to join the workspace).

![Email invitation field and access role](../assets/docs/deepnote-first-steps/workspace-email-invite.webp)

## Analyzing your data

Deepnote is a fully collaborative SQL and Python environment with a suite of no-code tools to help you move fast.

### SQL blocks

Create an SQL block and write native SQL queries against your CSVs and databases. Mix in Python to get the best of both languages. Results are saved to a Pandas DataFrame (am I repeating myself?).

![SQL and Python blocks in one notebook](../assets/docs/deepnote-first-steps/sql-python-blocks.webp)

### Python blocks

You probably expected Python blocks, but there's more to it than that. Use the preinstalled libraries, `pip install,` whatever you want — you can even define your environment with Docker.

![Python package imports and version output](../assets/docs/deepnote-first-steps/python-package-imports.webp)

### Moving fast with no-code tools

Visualize any Pandas DataFrame with [chart blocks](https://deepnote.com/docs/chart-blocks).

![Chart block configured from a DataFrame](../assets/docs/deepnote-first-steps/chart-block.webp)

Parameterize your notebook with [input blocks](https://deepnote.com/docs/input-blocks).

![Slider input used in a Python block](../assets/docs/deepnote-first-steps/input-block.webp)

Communicate with [rich text blocks](https://deepnote.com/docs/text-editing).

![Rich text in a Deepnote notebook](../assets/docs/deepnote-first-steps/rich-text-block.webp)
