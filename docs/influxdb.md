---
title: InfluxDB
description: Available to teams and users on all plans
noIndex: false
noContent: false
coverImage: g890zy2wQGiGh2NahdVa
---

Use Deepnote to query time series data in InfluxDB v2 with Python and Flux.

### 1. Duplicate the InfluxDB template

[Open the InfluxDB template](https://deepnote.com/workspace/Deepnote-Templates-71742312-24f2-4c10-9bf7-786d17280b92/project/Query-InfluxDB-from-Deepnote-46097291-95c8-4a64-a247-541975d8aadc/%2Fnotebook.ipynb)

![InfluxDB template with the Duplicate button in the top-right corner](../assets/docs/VoHNl6juQ5qUFurTn0DR.webp)

Click the "duplicate" button on the top right corner to do this. Once you've got the template in your Deepnote workspace, you can connect it to your InfluxDB instance.

### 2. Connect to InfluxDB from Deepnote

To connect to InfluxDB, you need an API token, your organization name, and your InfluxDB instance URL.

**Create an InfluxDB token**

[Create an InfluxDB token](https://docs.influxdata.com/influxdb/cloud/admin/tokens/create-token/) with read access to the bucket you want to query.

#### Update the token in the notebook

Change the variable `INFLUXDB_TOKEN` to the token you made in the previous step.

#### Update the organization and URL details in the notebook

Set `INFLUXDB_ORG` to your [organization name](https://docs.influxdata.com/influxdb/v2/admin/organizations/view-orgs/).

Change the variable `INFLUXDB_URL` to the URL where your InfluxDB instance is located.

### 3. Query InfluxDB from Deepnote

The template creates an InfluxDB Python `client`. Use `client.query_api()` to run a Flux query and return a pandas DataFrame. This example queries [InfluxDB's air sensor sample data](https://docs.influxdata.com/influxdb/v2/reference/sample-data/#air-sensor-sample-data).

```python
import pandas as pd

query_api = client.query_api()

query = """import "influxdata/influxdb/sample"

sample.data(set: "airSensor")
  |> filter(fn: (r) => r._field == "temperature")
  |> range(start: -45m)
  |> aggregateWindow(every: 1m, fn: mean)"""

result = query_api.query_data_frame(query)
if isinstance(result, list):
    df = pd.concat(result, ignore_index=True) if result else pd.DataFrame()
else:
    df = result

df
```

The client returns a DataFrame or, when result tables have different schemas, a list of DataFrames. The code combines that list into one DataFrame for display.

<Embed url="https://embed.deepnote.com/f1bda07e-1467-4298-955b-41b55e97fc75/299ab3c5-886e-4c29-9b86-04bda8b30e8f/0b9e56b351314e729b9cd10168c4e665?height=577" />

### What's next?

Share your results with your team or [publish your notebook as an app](/docs/creating-apps).

For more connection and query options, see the [InfluxDB Python client documentation](https://github.com/influxdata/influxdb-client-python).
