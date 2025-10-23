---
title: Google Spanner
description: Cloud Spanner is a highly scalable database that combines unlimited scalability with relational semantics, such as secondary indexes, strong consistency, schemas, and SQL providing 99.999% availability in one easy solution. Hence, it’s suitable for both relational and non-relational workloads.
noIndex: false
noContent: false
coverImage: TnQJ4V7TY2BuXsnKH6wB
---

## What can you do with the Google Spanner integration?

As with all of Deepnote's SQL-related integrations, the Google Spanner integration allows you to query databases and explore the structure of your database. Think "SQL editor" but with all the modern productivity boosters that come with Deepnote's notebook. For example,

- Write native SQL and Python in the same notebook
- Get intelligent autocomplete for columns, tables, and databases
- Interactively explore data without writing any additional code

### How to connect to Google Spanner

From the panel, under **Integrations**, click the **+** button and choose **Create new integration**.

Select Google Spanner from the list of integrations or search for it using the search bar.

Fill out the fields in the pop up form.

#### Authenticating with a service account

A service account will provide a shared connection to Google Spanner. That is, all collaborators will be able run queries against databases provisioned in the service account.

To use the service account authentication, you will need to supply a JSON service account key. [Click here for a guide on creating a JSON service account key](https://cloud.google.com/docs/authentication/getting-started). Your service account key will be encrypted and stored in Deepnote's database.

**Make sure to enable Spanner API for your GCP project.** The service account needs sufficient permissions for the resources you want to use. If the authorisation process fails, we recommend visiting the Spanner [access control page](https://cloud.google.com/spanner/docs/iam).

**Grant sufficient permissions to your service account.**
For Data Boost please enable `spanner.databases.useDataBoost`

In order to use our built in MYSQL blocks, you must run the following code in your notebook (also available from How to modal):

```
import os

!printf "%s" "$YOUR_INTEGRATION_NAME_HERE_SERVICE_ACCOUNT" > /tmp/google

os.environ['GOOGLE_APPLICATION_CREDENTIALS']="/tmp/google"
```

Make sure to replace YOUR_INTEGRATION_NAME_HERE with your a snakecased uppercased version of your integration name. Or simply add the code it from the How to Modal.

### Working with data from Google Spanner

Now that you are connected to your Google Spanner you can do the following actions in Deepnote:

- Create an SQL block that points to your database and begin querying your data. Autocomplete for columns, tables, and databases will be at your fingertips as you type. [Click here to learn more about SQL blocks](sql-cells).

- Explore column distributions as well as the sorting and filtering capabilities on the results set. All results are displayed as an interactive Pandas DataFrame. [Click here to learn about interactive DataFrame output](variable-explorer#interactive-dataframe-output).

- Pipe the results of your query into a chart block for rapid interactive data visualization. [Click here to learn more about chart blocks](chart-blocks).

![Screenshot 2023-06-29 at 15.53.55.png](https://media.graphassets.com/BpfgyDXQwyPxdtXMz7Rw)

### Using pure Python to connect to Google Spanner

To go beyond querying (like listing tables, creating datasets, etc.), you may need to use the official Python client library ([docs](https://cloud.google.com/python/docs/reference/spanner/latest)).

Use this code snippet to authenticate the Python client using the integration's service account:

```python
import os
from google.oauth2 import service_account
from google.cloud import spanner

spanner_credentials = service_account.Credentials.from_service_account_info(
    json.loads(os.environ['INTEGRATION_NAME_SERVICE_ACCOUNT']))
spanner_client = spanner.Client(credentials=spanner_credentials,
    project=spanner_credentials.project_id)

instance = spanner_client.instance('YOUR_INSTANCE_HERE')
database = instance.database('YOUR_DB_HERE')
```

Just replace the `INTEGRATION_NAME` with an uppercased, underscore-connected name of your integration. If you have trouble finding it, run this one-liner to list environment variables that contain service accounts:

```python
[var for var in os.environ if '_SERVICE_ACCOUNT' in var]
```

Once the Google Spanner `client` is initialized, you can use it to run queries and view the results as dataframes like this:

```
with database.snapshot() as snapshot:
results = snapshot.execute_sql("SELECT * from YOUR_TABLE_HERE")

    for row in results:
        print(row)"""
```

### Data Boost in Google Spanner

You can make use of Google Spanner's [Data Boost](https://cloud.google.com/spanner/docs/databoost/databoost-overview) in Deepnote. Ensure that the service account that runs the application has the `spanner.databases.useDataBoost` Identity and Access Management (IAM) permission. For more information, see Access control with IAM.

Then it is as simple as passing `data_boost_enabled=True` to valid queries to use Data Boost.
