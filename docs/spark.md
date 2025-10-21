---
title: Spark
noIndex: false
noContent: false
---

## What is Spark?

[Apache Spark](https://spark.apache.org/) is a multi-language engine for executing data engineering, data science, and machine learning on single-node machines or clusters.

## Spark in Deepnote

Deepnote is a great place for working with Spark! This combination allows you to leverage:

- Spark's rich ecosystem of tools and its powerful parallelization
- Deepnote's beautiful UI, its set of AI generative tools, the collaborative workspace and data apps

## Connecting to a remote cluster

A strong motivation for using Spark is its ability to process massive amounts of data, often using large clusters at the major cloud providers ([AWS EMR](https://aws.amazon.com/emr/), [GCP Dataproc](https://cloud.google.com/dataproc), [Databricks](https://www.databricks.com/) or [Azure HDInsight](https://azure.microsoft.com/en-us/products/hdinsight)), or managed internally by your staff. You can use those as the back-end for your heavy computation, while using Deepnote as the client thanks to the new decoupled client-server architecture called Spark Connect introduced in Spark 3.4.0.

### Requirements

**On your cluster:**

- Spark >= 3.4.0 on your cluster
- Ensure secure network connectivity, by picking [one of the options here](/docs/securing-connections)
- Start the Spark server with Spark Connect in your cloud provider of choice

**In your Deepnote project:**

- PySpark >= 3.4.0

For example, you can use the `jupyter/all-spark-notebook` Dockerhub image as a starting point as it has PySpark pre-installed. Or you could install PySpark as part of initialization, but because of its size we recommend to use Docker image to speed up notebook initialization. Learn more about [custom environments in Deepnote](/docs/custom-environment).

### General instructions

After starting your cluster, you need to connect to it from the notebook. For AWS EMR, GCP Dataproc, Azure HDInsight or other clusters, follow the instructions in the Spark [documentation](https://spark.apache.org/docs/latest/spark-connect-overview.html).

```
from pyspark.sql import SparkSession

# This example uses a remote EMR cluster
spark = SparkSession.builder.remote("sc://ec2-1-2-3-4.compute-1.amazonaws.com:15002").getOrCreate()
```

#### Databricks

For Databricks, you can leverage Databricks Connect.

```
!pip3 install --upgrade "databricks-connect==13.0.*"
```

Or X.Y.\* to match your cluster version

```
from databricks.connect import DatabricksSession

spark = DatabricksSession.builder.remote(
  host       = "my_host",
  token      = "my_token",
  cluster_id = "my_cluster_id",
).getOrCreate()
```

#### Interfacing with Deepnote features

Deepnote supports displaying PySpark DataFrames as an output of a code block. If the last expression of the code block evaluates to a PySpark DataFrame, its content will be rendered in our [data table](/docs/data-tables) component. You will be able to browse the data, apply filters and sorting, add cell formatting rules, and manage columns.

PySpark DataFrames can also be used in chart blocks, no need to convert them to Pandas. Just select PySpark DataFrame as a source of data for the chart. All necessary aggregations will be pushed to Spark, so you're not limited by memory available on your project machine. Learn more about [charting in Deepnote](/docs/chart-blocks).

<Callout status="warning">
Deepnote charts process datetimes assuming the UTC timezone (when not set explicitly). Due to the specifics of Spark and how it handles timestamps, we recommend setting the Spark timezone to UTC to avoid inaccuracies when working with datetimes. You can do this by configuring the default timezone in your Spark config or setting it per session:

```python
# When creating SparkSession
spark = (SparkSession.builder
         .config("spark.sql.session.timeZone", "UTC")
         .getOrCreate())

# Or later when modifying existing session
spark.conf.set("spark.sql.session.timeZone", "UTC")
```

</Callout>
