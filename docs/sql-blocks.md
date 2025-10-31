---
title: SQL blocks in Deepnote open source
description: Complete guide to using SQL blocks in Deepnote for database queries, variable assignment, and local execution.
noIndex: false
noContent: false
---

# SQL blocks in Deepnote open source

SQL blocks are a powerful feature in Deepnote that allow you to execute SQL queries directly against connected databases and assign the results to Python variables. This makes it easy to combine SQL data retrieval with Python data analysis in the same notebook.

SQL blocks provide:

- **Direct database connectivity** - Query databases without writing Python connection code
- **Variable assignment** - Automatically assign query results to Python variables
- **Result caching** - Cache query results for faster re-execution
- **DataFrame output** - Results returned as pandas DataFrames or QueryPreview objects
- **Table state configuration** - Control how results are displayed
- **Jinja2 templating** - Use Python variables in SQL queries (via `deepnote_toolkit`)

## Basic structure

```yaml
- id: block-001
  type: sql
  sortingKey: "1"
  content: |
    SELECT * FROM users
    WHERE created_at > '2024-01-01'
    LIMIT 100
  executionCount: 1
  metadata:
    deepnote_variable_name: users_df
    sql_integration_id: postgres-prod
    deepnote_return_variable_type: dataframe
```

## Metadata fields

### Required fields

#### `sql_integration_id`

The ID of the database integration to use for the query. This corresponds to an integration defined in the project's integrations array.

```yaml
metadata:
  sql_integration_id: snowflake-warehouse
```

**Common integration types:**

- `postgres` - PostgreSQL
- `mysql` - MySQL/MariaDB
- `snowflake` - Snowflake
- `bigquery` - Google BigQuery
- `redshift` - Amazon Redshift
- `databricks` - Databricks SQL
- `clickhouse` - ClickHouse

### Optional fields

#### `deepnote_variable_name`

The Python variable name to assign the query results to. If not specified, results are displayed but not assigned.

```yaml
metadata:
  deepnote_variable_name: customer_data
```

**Variable naming rules:**

- Must be a valid Python identifier
- Will be automatically sanitized (e.g., `user-data` becomes `user_data`)
- Defaults to `input_1`, `input_2`, etc. if invalid

#### `deepnote_return_variable_type`

The type of object to return. Options:

- `'dataframe'` (default) - Returns a pandas DataFrame
- `'query_preview'` - Returns a QueryPreview object with additional metadata

```yaml
metadata:
  deepnote_return_variable_type: dataframe
```

**DataFrame vs QueryPreview:**

| Feature     | DataFrame              | QueryPreview                            |
| ----------- | ---------------------- | --------------------------------------- |
| Type        | `pandas.DataFrame`     | `deepnote_toolkit.QueryPreview`         |
| Use case    | Standard data analysis | Query chaining, metadata access         |
| Methods     | All pandas methods     | Pandas methods + `.sql()`, `.preview()` |
| Performance | Standard               | Optimized for large results             |

#### `deepnote_table_state`

Configuration for how the result table is displayed:

```yaml
metadata:
  deepnote_table_state:
    sortBy: []
    filters: []
    pageSize: 50
    pageIndex: 0
    columnOrder: ["id", "name", "email", "created_at"]
    hiddenColumnIds: ["internal_id", "password_hash"]
    columnDisplayNames: []
    conditionalFilters: []
    cellFormattingRules: []
    wrappedTextColumnIds: []
```

#### `function_export_name`

Name for exporting the query as a reusable function (advanced use case).

```yaml
metadata:
  function_export_name: get_active_users
```

#### `is_compiled_sql_query_visible`

Whether to show the compiled SQL query (useful when using Jinja2 templates).

```yaml
metadata:
  is_compiled_sql_query_visible: true
```

## Python Code Generation

When a SQL block is converted to Python for local execution, it generates code using the `deepnote_toolkit` library:

### With Variable Assignment

**SQL Block:**

```yaml
- type: sql
  content: |
    SELECT 
      customer_id,
      SUM(amount) as total_spent,
      COUNT(*) as order_count
    FROM orders
    WHERE order_date >= '2024-01-01'
    GROUP BY customer_id
    ORDER BY total_spent DESC
    LIMIT 100
  metadata:
    deepnote_variable_name: top_customers
    sql_integration_id: postgres-prod
    deepnote_return_variable_type: dataframe
```

**Generated Python:**

```python
if '_dntk' in globals():
  _dntk.dataframe_utils.configure_dataframe_formatter('{}')
else:
  _deepnote_current_table_attrs = '{}'

top_customers = _dntk.execute_sql(
  'SELECT \n  customer_id,\n  SUM(amount) as total_spent,\n  COUNT(*) as order_count\nFROM orders\nWHERE order_date >= \'2024-01-01\'\nGROUP BY customer_id\nORDER BY total_spent DESC\nLIMIT 100',
  'SQL_POSTGRES_PROD',
  audit_sql_comment='',
  sql_cache_mode='cache_disabled',
  return_variable_type='dataframe'
)
top_customers
```

### Without Variable Assignment

**SQL Block:**

```yaml
- type: sql
  content: SELECT COUNT(*) FROM users
  metadata:
    sql_integration_id: postgres-prod
```

**Generated Python:**

```python
if '_dntk' in globals():
  _dntk.dataframe_utils.configure_dataframe_formatter('{}')
else:
  _deepnote_current_table_attrs = '{}'

_dntk.execute_sql(
  'SELECT COUNT(*) FROM users',
  'SQL_POSTGRES_PROD',
  audit_sql_comment='',
  sql_cache_mode='cache_disabled',
  return_variable_type='dataframe'
)
```

## Common use cases

Load data from a database into a DataFrame for analysis:

```yaml
- type: sql
  content: |
    SELECT *
    FROM sales_data
    WHERE date >= CURRENT_DATE - INTERVAL '30 days'
  metadata:
    deepnote_variable_name: recent_sales
    sql_integration_id: snowflake-warehouse
```

Then use in a code block:

```python
# Analyze recent sales
print(f"Total sales: ${recent_sales['amount'].sum():,.2f}")
print(f"Average order: ${recent_sales['amount'].mean():.2f}")
print(f"Number of orders: {len(recent_sales)}")
```

## Working with results

### DataFrame operations

Once assigned to a variable, you can use all pandas operations:

```python
# After SQL block assigns to 'sales_df'

# Filter
high_value = sales_df[sales_df['amount'] > 1000]

# Group by
by_region = sales_df.groupby('region')['amount'].sum()

# Sort
top_products = sales_df.sort_values('revenue', ascending=False).head(10)

# Merge with other data
combined = sales_df.merge(customers_df, on='customer_id')
```

### QueryPreview Operations

When using `deepnote_return_variable_type: 'query_preview'`:

```python
# After SQL block assigns to 'data' as QueryPreview

# Chain additional SQL queries
filtered = data.sql("SELECT * FROM data WHERE amount > 100")

# Preview first rows
data.preview(10)

# Convert to DataFrame
df = data.to_dataframe()

# Access metadata
print(data.row_count)
print(data.column_names)
```

## Integration with code blocks

SQL blocks work seamlessly with code blocks:

```yaml
# SQL block 1: Load user data
- type: sql
  content: SELECT * FROM users WHERE active = true
  metadata:
    deepnote_variable_name: users
    sql_integration_id: postgres-prod

# Code Block: Process data
- type: code
  content: |
    # users DataFrame is available from SQL block
    print(f"Active users: {len(users)}")

    # Add calculated columns
    users['days_since_signup'] = (
      pd.Timestamp.now() - pd.to_datetime(users['signup_date'])
    ).dt.days

    # Filter
    new_users = users[users['days_since_signup'] < 30]

# SQL block 2: Load orders for new users
- type: sql
  content: |
    SELECT *
    FROM orders
    WHERE user_id IN ({{ new_users['user_id'].tolist() }})
  metadata:
    deepnote_variable_name: new_user_orders
    sql_integration_id: postgres-prod
```

## Environment variables

SQL integrations are accessed via environment variables. The pattern is:

```
SQL_{INTEGRATION_TYPE}_{INTEGRATION_ID}
```

For example:

- `sql_integration_id: 'postgres-prod'` → `SQL_POSTGRES_PROD`
- `sql_integration_id: 'snowflake-warehouse'` → `SQL_SNOWFLAKE_WAREHOUSE`

The environment variable contains a JSON string with connection details:

```json
{
  "host": "db.example.com",
  "port": 5432,
  "database": "analytics",
  "username": "readonly_user",
  "password": "***"
}
```

## Local execution requirements

To execute SQL blocks locally, you need:

1. **deepnote_toolkit** installed:

   ```bash
   pip install deepnote-toolkit
   ```

2. **Database drivers** for your database type:

   ```bash
   # PostgreSQL
   pip install psycopg2-binary

   # MySQL
   pip install pymysql

   # Snowflake
   pip install snowflake-connector-python

   # BigQuery
   pip install google-cloud-bigquery
   ```

3. **Environment variables** set with connection details:
   ```bash
   export SQL_POSTGRES_PROD='{"host":"localhost","port":5432,...}'
   ```
