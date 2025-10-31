# @deepnote/database-integrations

The database-integrations package defines the Deepnote database integrations.

## Overview

This package provides TypeScript types and utilities for working with Deepnote SQL block integrations and other database integrations, including:

- **Integration types**
- **Authentication method types**
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

### MongoDB usage

MongoDB is not a SQL integration, it is not used via SQL blocks but rather via code blocks and `pymongo`.

```python
import os
from pymongo import MongoClient

# Connect to MongoDB using the connection string from environment variables
client = MongoClient(os.environ["INTEGRATION_NAME_CONNECTION_STRING"])
db = client[os.environ["INTEGRATION_NAME_DATABASE"]]`,
      `# Get the users collection
users_collection = db["users"]

# Find all documents in the users collection
users = list(users_collection.find())
```

Note: The `INTEGRATION_NAME_` prefix of the env variables is constructed using the following logic.

> Environment variable names used by the utilities in the Shell and Utilities volume of IEEE Std 1003.1-2001 consist solely of uppercase letters, digits, and the '\_' (underscore) from the characters defined in the Portable Character Set and do not begin with a digit.

```python
import re

def convert_to_environment_variable_name(integration_name: string) -> str:
  without_first_digit = f"_{integration_name}" if re.match(r'^\d', integration_name) else integration_name
  upper_cased = without_first_digit.upper()
  return re.sub(r'[^\w]', '_', upper_cased)
```
