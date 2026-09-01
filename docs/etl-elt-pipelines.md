---
title: ETL/ELT pipelines
noIndex: false
noContent: false
---

Use a Deepnote notebook to extract data from a source, transform it with Python or SQL, and load it into another system. You can connect the notebook to services such as Snowflake and Amazon S3, track changes, and schedule runs.

## Build an ETL pipeline

ETL stands for Extract, Transform, Load. Use this approach when you need to clean, enrich, or restructure data before storing it in the target system.

The following example moves data from Snowflake to Amazon S3:

1. Open your project's **Settings** panel, select **Integrations**, and add a Snowflake integration with your credentials.
2. Create a notebook and query the source data through the Snowflake integration.
3. Transform the data in the notebook. For example, increase a salary column by 10%.
4. Save the transformed data to an Amazon S3 bucket.

## Build an ELT pipeline

ELT stands for Extract, Load, Transform. It loads data into the target system before transforming it, so the target system handles the computation.

For an ELT pipeline in Snowflake, load the source data through the Snowflake integration and run the transformations in Snowflake with SQL.

### Transformations with dbt

You can use dbt (data build tool) for the transformation layer. Write SQL transformations in dbt models, test data quality, and document the models.

For more information, check out the [dbt documentation](https://docs.getdbt.com/).

## Example project

The [example ETL and ELT notebook](https://deepnote.com/workspace/Deepnote-Templates-71742312-24f2-4c10-9bf7-786d17280b92/project/ETLELT-pipeline-d0cd4ccf-eede-4a0d-a59d-af64946f9c06/notebook/%F0%9F%91%BE%20Example%201-e77960b4460d401dacf2435a173da647) shows the pipeline in a Deepnote project.

You can invite teammates to edit the pipeline, use comments to discuss changes, or schedule the notebook. You can share its results through a link, data app, or PDF export.

## Choose ETL or ELT

Choose ETL when the data needs preprocessing before it reaches the target system. Choose ELT when you want the target system to run the transformations after loading the source data.
