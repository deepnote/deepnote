# @deepnote/sql-integrations

The sql-integrations package defines the Deepnote SQL Integrations.

## Overview

This package provides TypeScript types and utilities for working with Deepnote SQL block integrations, including:

- **Integration types**
- **Integration metadata schemas**

## Supported Integrations

- DataFrame SQL (`pandas-dataframe`)
- Amazon Athena (`athena`)
- Amazon Redshift (`redshift`)
- ClickHouse (`clickhouse`)
- Databricks (`databricks`)
- Dremio (`dremio`)
- Google AlloyDB (`alloydb`)
- Google BigQuery (`big-query`)
- Google Spanner (`spanner`)
- MariaDB (`mariadb`)
- Materialize (`materialize`)
- Microsoft SQL Server (Azure SQL) (`sql-server`)
- MindsDB (`mindsdb`)
- MongoDB (`mongodb`)
- MySQL (`mysql`)
- PostgreSQL (`pgsql`)
- Snowflake (`snowflake`)
- Trino (`trino`)

## Usage

```ts
import {
  type BigQueryAuthMethods,
  type SqlIntegrationMetadataByType,
  type SqlIntegrationType,
  sqlMetadataValidationSchemasByType,
  sqlIntegrationTypes,
} from "@deepnote/sql-integrations";

// show list of available integrations
console.log(sqlIntegrationTypes); // ['athena', 'redshift', …]

// set integration metadata
const newMetadata: SqlIntegrationMetadataByType["big-query"] = {
  authMethod: BigQueryAuthMethods.ServiceAccount,
  service_account: "my-account",
};

// validate integration metadata
const validationResult = sqlMetadataValidationSchemasByType[
  "big-query"
].safeParse({
  authMethod: BigQueryAuthMethods.ServiceAccount,
  service_account: "my-account",
});
if (validationResult.error) {
  console.error(validationResult.error);
}

// mapped types
const myIntegrationDocsLinks: Record<SqlIntegrationType, { docsLink: string }> =
  {
    "big-query": { docsLink: "https://example.com/my-docs/bq" },
    // …
  };
```
