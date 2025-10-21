---
title: InfluxDB
description: Available to teams and users on all plans
noIndex: false
noContent: false
coverImage: g890zy2wQGiGh2NahdVa
---

Deepnote can query your time series data in InfluxDB v2. Follow these docs to create your own notebook to connect to your InfluxDB instance.

### 1. Duplicate the InfluxDB template

[Open the template by following this link ->](https://deepnote.com/workspace/Deepnote-Templates-71742312-24f2-4c10-9bf7-786d17280b92/project/Query-InfluxDB-from-Deepnote-46097291-95c8-4a64-a247-541975d8aadc/%2Fnotebook.ipynb)

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FuBTyirnZvPcOcczBxtFa%2Fduplicate-notebook.png](https://media.graphassets.com/VoHNl6juQ5qUFurTn0DR)

Click the "duplicate" button on the top right corner to do this. Once you've got the template in your Deepnote workspace, you can connect it to your InfluxDB instance.

### 2. Connect to InfluxDB from Deepnote

To connect to SQL from Deepnote, you'll need credentials to connect to a database and the endpoint where that database is located.

**Create an InfluxDB token**

[Follow these instructions](https://docs.influxdata.com/influxdb/cloud/security/tokens/create-token/) to create a token that has permission to access the bucket you're interested in.

#### Update the token in the notebook

Change the variable `INFLUXDB_TOKEN` to the token you made in the previous step.

#### Update the organization and URL details in the notebook

Change the variable `INFLUXDB_ORG` to the name of your organization, [here is how you can find it](https://docs.influxdata.com/influxdb/v2.2/organizations/view-orgs/).

Change the variable `INFLUXDB_URL` to the URL where your InfluxDB instance is located.

### 3. Query InfluxDB from Deepnote

The notebook will set up a `client` object from the InfluxDB Python library. You can create a query client with this object, and query InfluxDB directly to a Pandas DataFrame. In the example below, we query [InfluxDB's built-in sample data](https://docs.influxdata.com/influxdb/v2.2/reference/sample-data/#air-sensor-sample-data).

```python
query_api = client.query_api()

query = """import "influxdata/influxdb/sample"

sample.data(set: "airSensor")
  |> filter(fn: (r) => r._field == "temperature")
  |> range(start: -45m)
  |> aggregateWindow(every: 1m, fn: mean)"""

# influxdb_client gives us Pandas dataframes out-of-the-box
df = query_api.query_data_frame(query)

df
```

Running the code above will have Deepnote query the InfluxDB instance, save the result into a DataFrame, and visualize it in an interactive table like the one below.

<Embed url="https://embed.deepnote.com/f1bda07e-1467-4298-955b-41b55e97fc75/299ab3c5-886e-4c29-9b86-04bda8b30e8f/0b9e56b351314e729b9cd10168c4e665?height=577" />

### What's next?

Now that you're querying data, you can share it with your team. You can even turn your charts [into a shareable dashboard](/docs/publish-projects).

For more information on connecting to InfluxDB from Python, [you can read the influxdb-client-python docs](https://github.com/influxdata/influxdb-client-python).
