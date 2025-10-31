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

## API reference

### Integration types

- types
  - `type DatabaseIntegrationType` – All supported database integration types
  - `type DatabaseIntegrationTypeWithSslSupport` – Database integration types that support SSL (subset of `DatabaseIntegrationType`)
  - `type SqlIntegrationType` – SQL integration types (subset of `DatabaseIntegrationType`), excludes `mongodb`
- runtime values
  - `databaseIntegrationTypes` – Array of all supported database integration types (`DatabaseIntegrationType[]`)
  - `databaseIntegrationTypesWithSslSupport` – Array of all database integration types that support SSL (`DatabaseIntegrationTypeWithSslSupport[]`)
  - `sqlIntegrationTypes` – Array of all SQL integration types (`SqlIntegrationType[]`)

### Integration metadata

- zod schemas
  - `databaseMetadataSchemasByType` – Zod schemas for validating integration metadata by integration type
    ```ts
    databaseMetadataSchemasByType['big-query'].safeParse({ ... })
    ```
- types
  - `type DatabaseIntegrationMetadataByType` – Integration metadata types by integration type
    ```ts
    const metadata: databaseMetadataSchemasByType['big-query'] = { ... }
    ```

### Environment variables and configuration

- utilities
  - `getIntegrationListEnv(integrations: Array<DatabaseIntegrationConfig>, params: { projectRootDirectory: string, snowflakePartnerIdentifier?: string })` – Creates a list of environment variables to be set when executing a notebook that uses the integrations, the variables are in a format consumed by the Deepnote Toolkit
    - arguments:
      - `integrations` – list of active integrations
      - `params.projectRootDirectory` – project root directory, used to construct paths to CA certificates
      - `params.snowflakePartnerIdentifier` (optional) – Snowflake partner identifier, used to construct Snowflake connection URLs; it is used for Snowflake's internal telemetry/analytics, it does not affect the functionality of the integration
    - returns:
      - `envVars: Array<EnvVar>` – List of environment variables to be set when executing a notebook that uses the integrations
        - The variable names produced have the following format:
          - `*INTEGRATION_NAME*_*METADATA_KEY*` - for each metadata field of the integration
          - `SQL_*INTEGRATION_ID*` - SQL Alchemy config for each SQL integration
      - `errors: Array<Error>` – List of errors that occurred when generating the environment variables. These are not thrown to allow partial functionality, even when some integrations are misconfigured.
  - `getSqlAlchemyInput(sqlIntegration: SqlIntegrationConfig, params: { projectRootDirectory: string, snowflakePartnerIdentifier?: string })` – Creates a SQL Alchemy config for a SQL integration, used to connect to the database from SQL blocks. This is used internally within `getIntegrationListEnv()`.
    - arguments:
      - `sqlIntegration` – SQL integration configuration
      - `params.projectRootDirectory` – project root directory, used to construct paths to CA certificates
      - `params.snowflakePartnerIdentifier` (optional) – see above
    - returns:
      - `SqlAlchemyInput | null` – SQL Alchemy config for the integration, `null` when the integration has federated authentication
    - throws:
      - `BigQueryServiceAccountParseError` – when parsing BigQuery service account fails
      - `SpannerServiceAccountParseError` – when parsing Spanner service account fails
- types
  - `type DatabaseIntegrationConfig` – Configuration for an integration when generating environment variables
    - `type` – integration type
    - `id` – integration ID (usually UUID)
    - `name` – integration name
    - `metadata` – integration metadata
    - `federated_auth_method` (optional) – federated authentication method, used only when the integration has federated authentication enabled. The auth method configured via the metadata is also checked, these should match.
  - `type SqlIntegrationConfig` – Configuration for a SQL integration when generating environment variables (subset of `DatabaseIntegrationConfig`, excluding non-SQL integrations)
  - `type SqlAlchemyInput` - SQL Alchemy config for a SQL integration
- errors
  - `BigQueryServiceAccountParseError` – When parsing BigQuery service account fails
    - `cause: Error` – The original error
  - `SpannerServiceAccountParseError` – When parsing Spanner service account fails
    - `cause: Error` – The original error

### Auth methods

These values can be used to configure the integrations that have multiple methods for authentication.

- types
  - `type DatabaseAuthMethod` – Authentication method for a database integration
  - `type AwsAuthMethod` – Authentication method for an AWS integration
  - `type BigQueryAuthMethod` – Authentication method for a BigQuery integration
  - `type SnowflakeAuthMethod` – Authentication method for a Snowflake integration
  - `type FederatedAuthMethod` – Authentication method for a federated authentication integration
- runtime values
  - `AwsAuthMethods` – All supported AWS authentication methods
  - `BigQueryAuthMethods` – All supported BigQuery authentication methods
  - `DatabaseAuthMethods` – All supported database authentication methods
  - `SnowflakeAuthMethods` – All supported Snowflake authentication methods
  - `federatedAuthMethods` – All supported federated authentication methods

## Usage in TypeScript

### Example: Show list of available integrations

```ts
import { databaseIntegrationTypes } from "@deepnote/database-integrations";

console.log(databaseIntegrationTypes); // ['athena', 'redshift', …]
```

### Example: Validate integration metadata

```ts
import { databaseMetadataSchemasByType } from "@deepnote/database-integrations";

const validationResult = databaseMetadataSchemasByType["big-query"].safeParse({
  authMethod: BigQueryAuthMethods.ServiceAccount,
  service_account: "my-account",
});
if (validationResult.error) {
  console.error(validationResult.error);
}
```

### Example: Getting environment variables for configured integrations

```ts
import { getIntegrationListEnv } from "@deepnote/database-integrations";

const integrations = [
  {
    type: "pgsql",
    id: "my-postgres",
    name: "My PostgreSQL Integration",
    metadata: {
      host: "my-host",
      user: "my-user",
      password: "my-password",
      database: "my-database",
    },
  },
];

const { envVars } = getIntegrationListEnv(integrations, {
  projectRootDirectory: "/path/to/project",
});

// envVars = [
//   { name: "INTEGRATION_MY_POSTGRES_HOST", value: "my-host" },
//   { name: "INTEGRATION_MY_POSTGRES_USER", value: "my-user" },
//   { name: "INTEGRATION_MY_POSTGRES_PASSWORD", value: "my-password" },
//   { name: "INTEGRATION_MY_POSTGRES_DATABASE", value: "my-database" },
//   { name: "SQL_MY_POSTGRES", value: '{"url": "postgresql://my-user:my-password@my-host/my-database", "params": {}, "param_style": "pyformat"}' },
// ]
```

### Example: Mapped types

```ts
import {
  type DatabaseIntegrationMetadataByType,
  type DatabaseIntegrationType,
} from "@deepnote/database-integrations";

const myIntegrationDocsLinks: Record<
  DatabaseIntegrationType,
  { docsLink: string }
> = {
  "big-query": { docsLink: "https://example.com/my-docs/bq" },
  // …
};
```

## Usage in notebooks

SQL block execution (set up in `@deepnote/blocks`) picks the environment variables and passes them to the Deepnote Toolkit (`_dntk.execute_sql()`)

### MongoDB usage

MongoDB is not a SQL integration, it is not used via SQL blocks but rather via code blocks and `pymongo`.

```python
import os
from pymongo import MongoClient

# Connect to MongoDB using the connection string from environment variables
client = MongoClient(os.environ["INTEGRATION_NAME_CONNECTION_STRING"])
db = client[os.environ["INTEGRATION_NAME_DATABASE"]]
# Get the users collection
users_collection = db["users"]
# Find all documents in the users collection
users = list(users_collection.find())
```

Note: The `INTEGRATION_NAME_` prefix of the env variables is constructed using the following logic.

> Environment variable names used by the utilities in the Shell and Utilities volume of IEEE Std 1003.1-2001 consist solely of uppercase letters, digits, and the '\_' (underscore) from the characters defined in the Portable Character Set and do not begin with a digit.

```python
import re

def convert_to_environment_variable_name(integration_name: str) -> str:
  without_first_digit = f"_{integration_name}" if re.match(r'^\d', integration_name) else integration_name
  upper_cased = without_first_digit.upper()
  return re.sub(r'[^\w]', '_', upper_cased)
```
