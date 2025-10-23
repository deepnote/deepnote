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

![Import_CSV_Squared.jpg](https://media.graphassets.com/N5sICTLi0cSODwkEXkwe)

An SQL block with a sample query will be created for you and the file will be uploaded to Deepnote's file system. The results are saved to a Pandas DataFrame.

![Query_it_with_SQL.jpg](https://media.graphassets.com/UVu8NCRzREm1LUKLk8dy)

Pandas can also be used to read the uploaded CSV into the notebook's memory.

![Query_it_with_python.jpg](https://media.graphassets.com/LKQbquJRqGEZmuH1sivy)

### Connecting to a database

Click "Create new" from the **Integrations** section in the Project sidebar on the left.

Choose the database integration you want (e.g., Snowflake, BigQuery, PostgreSQL). You'll be asked to add your credentials.

![Connect_database_From_project.jpg](https://media.graphassets.com/ghICx4WQgqqhiMrLDIUq)

Once you've connected the database to a project (It'll appear in your sidebar), you can click it to preview its schema and use SQL blocks to query your data. The results are saved to a Pandas DataFrame.

![Preview_Schema and Query.jpg](https://media.graphassets.com/Aw5nXRIZTmo2DXhUGYhg)

## Inviting your team members

It's dangerous to go alone. Take this link.

### Links, email invites, and business domains

From the **Settings & members** section in the left-hand panel, you'll find links that you can send to your team in order to invite them to the workspace.

![Members_Page.jpg](https://media.graphassets.com/GTEICRTtGtfHZareqjnA)

Different links provide different access controls.

![Invite_Link.jpg](https://media.graphassets.com/RZeTuVcnTwiOHJbJWGul)

Alternatively, you may enter email addresses and assign access controls that way (note the toggle switch that allows anyone with your business domain to join the workspace).

![Alternatively_Invite.jpg](https://media.graphassets.com/R151o7DRta8abJfIn7W1)

## Analyzing your data

Deepnote is a fully collaborative SQL and Python environment with a suite of no-code tools to help you move fast.

### SQL blocks

Create an SQL block and write native SQL queries against your CSVs and databases. Mix in Python to get the best of both languages. Results are saved to a Pandas DataFrame (am I repeating myself?).

![Combine_SQL&Python.jpg](https://media.graphassets.com/hxQB0czRAixz87ASLcOA)

### Python blocks

You probably expected Python blocks, but there's more to it than that. Use the preinstalled libraries, `pip install,` whatever you want — you can even define your environment with Docker.

![Install_Libraries.jpg](https://media.graphassets.com/eCOg7oQJRvGW5I24jruC)

### Moving fast with no-code tools

Visualize any Pandas DataFrame with [chart blocks](https://deepnote.com/docs/chart-blocks).

![Leverage_Visualizations.jpg](https://media.graphassets.com/fh48Ob32QOSM05NbMkD7)

Parameterize your notebook with [input blocks](https://deepnote.com/docs/input-blocks).

![Leverage_Input_Blocks.jpg](https://media.graphassets.com/y3cf1J4Tc2XOba86JvPX)

Communicate with [rich text blocks](https://deepnote.com/docs/text-editing).

![Rich_Text.jpg](https://media.graphassets.com/DnwLKlQ2aXIv1vEKId6g)
