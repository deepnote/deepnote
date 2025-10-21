---
title: Google BigQuery
description: Google BigQuery is a fully managed, serverless data warehouse with built-in machine learning capabilities.
noIndex: false
noContent: false
---

## What can you do with the Google BigQuery integration?

As with all of Deepnote's SQL-related integrations, the Google BigQuery integration allows you to query databases and explore the structure of your warehouse. Think "SQL editor" but with all the modern productivity boosters that come with Deepnote's notebook. For example,

- Write native SQL and Python in the same notebook
- Search your entire warehouse instantly via the integrated schema explorer
- Get intelligent autocomplete for columns, tables, and databases
- Interactively explore data without writing any additional code
- Run queries powered by BigQuery DataFrames

<Callout status="info">
Available on Team and Enterprise plans
</Callout>

### How to connect to Google BigQuery

From the right-hand panel, under **Integrations**, click the **+** button and choose **Create new integration**.
![create_integration.png](https://media.graphassets.com/pIr2x2wQtyVUUAv6spVZ)
<br></br>

Select Google BigQuery from the list of integrations or search for it using the search bar.
![google_select_int.png](https://media.graphassets.com/L0AQ9K9RSn2NCuUbtwPR)
<br></br>

Fill out the fields in the pop up form. Importantly, you will need to select the desired authentication method and supply the related credentials (described below).
![gbq_modal.png](https://media.graphassets.com/rKvTSWW8TvaPqaCJdsVb)

#### Authenticating with a service account

A service account will provide a shared connection to Google BigQuery. That is, all collaborators with least **Editor** privileges will be able run queries against databases provisioned in the service account.

To use the service account authentication, you will need to supply a JSON service account key. [Click here for a guide on creating a JSON service account key](https://cloud.google.com/docs/authentication/getting-started). Your service account key will be encrypted and stored in Deepnote's database.

<Callout status="warning">

**Make sure to enable BigQuery API for your GCP project.** The service account needs sufficient permissions for the resources you want to use. If the authorisation process fails, we recommend visiting BigQuery's [access control page](https://cloud.google.com/bigquery/docs/access-control).

**Grant sufficient permissions to your service account.** The minimum required permissions are: _BigQuery Job User_, _BigQuery Read Session User_, and _BigQuery Data Viewer_. The best practice is to only grant this last role for specific datasets or tables you wish to explore in Deepnote.

</Callout>

#### Authenticating to BigQuery with Google OAuth

<Callout status="info">
Available on the Enterprise plan
</Callout>

With BigQuery's Google OAuth authentication you can give every member of your Deepnote workspace their own set of credentials. This ensures greater security by using short-lived tokens and enabling the use of multi-factor authentication. Follow the principle of least privilege and use granular access control for various BigQuery resources to ensure users can only access the data they need. [Click here to learn how to set up BigQuery's Google OAuth authentication in Deepnote](bigquery-oauth).

### Working with data from Google BigQuery

Now that you are connected to your Google BigQuery can do the following actions in Deepnote:

- Click the newly created integration in the **Integrations** section to open the schema browser. [Click here to learn more about the schema browser](schema-browser).

- Create an SQL block that points to your warehouse and begin querying your data. Autocomplete for columns, tables, and databases will be at your fingertips as you type. [Click here to learn more about SQL blocks](sql-cells).

- Explore column distributions as well as the sorting and filtering capabilities on the results set. All results are displayed as an interactive Pandas DataFrame. [Click here to learn about interactive DataFrame output](variable-explorer#interactive-dataframe-output).

- Pipe the results of your query into a chart block for rapid interactive data visualization. [Click here to learn more about chart blocks](chart-blocks).

### Using pure Python to connect to BigQuery

To go beyond querying (like listing tables, creating datasets, etc.), you may need to use the official Python client library ([docs](https://googleapis.dev/python/bigquery/latest/index.html)).

Use this code snippet to authenticate the python client using the integration's service account:

```python
import json
import os
from google.oauth2 import service_account
from google.cloud import bigquery

bq_credentials = service_account.Credentials.from_service_account_info(
    json.loads(os.environ['INTEGRATION_NAME_SERVICE_ACCOUNT']))
client = bigquery.Client(credentials=bq_credentials,
    project=bq_credentials.project_id)
```

Just replace the `INTEGRATION_NAME` with an uppercased, underscore-connected name of your integration. If you have trouble finding it, run this one-liner to list environment variables that contain service accounts:

```python
[var for var in os.environ if '_SERVICE_ACCOUNT' in var]
```

Once the BigQuery `client` is initialized, you can use it to run queries and materialize the results as dataframes like this:

```python
sql = """
SELECT *
FROM `bigquery-public-data.usa_names.usa_1910_current`
LIMIT 1000
"""

df = client.query(sql).to_dataframe()
```

### Working with Multiple Projects

Deepnote's BigQuery integration supports querying data over multiple projects, offering a flexible and powerful way to handle diverse datasets across your Google Cloud Platform (GCP) environment. This capability is particularly useful for users managing or analyzing data across various GCP projects.

To leverage this feature, you must set up the necessary access permissions within GCP. Ensure your service account or Google OAuth credentials are configured to access all the projects you intend to work with. For detailed guidance on managing access and permissions in GCP, you can refer to the [GCP documentation on access control](https://cloud.google.com/bigquery/docs/access-control).

Once you have the required access, querying data from different projects is straightforward. In your SQL queries, use the `projectId.dataset.table` format to specify exactly where your data resides. This format allows you to seamlessly switch between datasets hosted in different projects without changing your connection settings.

![big-query-1.png](https://media.graphassets.com/TSkzUZdIQfeK9229xSTj)

Deepnote's schema explorer enhances your ability to browse through various projects and tables. With this tool, you can visually inspect the structure of your datasets, including the columns and their data types, across different GCP projects. This feature simplifies the process of understanding and navigating through your data, especially when dealing with multiple projects.

![big-query-2.png](https://media.graphassets.com/XcgsadbwQUCt0q7cYUWt)

By utilizing these features, Deepnote users can effectively manage and analyze data across multiple GCP projects, making it a robust solution for complex data environments.
