---
title: PostgreSQL
noIndex: false
noContent: false
---

## Setup

To add a connection to PostgreSQL, go to **Integrations** via the **right-hand sidebar**, create a new PostgreSQL integration and enter credentials:

![pg.png](https://media.graphassets.com/daU32gzMSFOGQbHw9EL3)

Don't forget to connect the newly created "PostgreSQL" integration in the Integrations sidebar.

### Authorizing Deepnote's IP addresses for security reasons

<Callout status="info">
If your connection is protected, you might need to add Deepnote's IP addresses to your allowlist. [Read more here](/docs/authorize-deepnote-ip-addresses)
</Callout>

## Usage

The fastest way to query your connected postgres database is to use a [SQL cell](/docs/sql-cells). You can create one by clicking "+ Block" or at the bottom of a notebook.

![image.png](https://media.graphassets.com/KMoRPKCNQamVvyoUJIJx)

A text input cell and a SQL cell work together

## Advanced usage

Alternatively, if you want to use python to access the database, access the connection details via environment variables with a common prefix that's generated from the name of your Postgres integration:

- `<INTEGRATION_NAME>_HOST`
- `<INTEGRATION_NAME>_DATABASE`
- `<INTEGRATION_NAME>_PORT`
- `<INTEGRATION_NAME>_USER`
- `<INTEGRATION_NAME>_PASSWORD`

Then you'll be able to connect to a database like this:

```python
import psycopg2
import os

try:
    connection = psycopg2.connect(
        user=os.environ["MY_INTEGRATION_USER"],
        password=os.environ["MY_INTEGRATION_PASSWORD"],
        host=os.environ["MY_INTEGRATION_HOST"],
        port=os.environ["MY_INTEGRATION_PORT"],
        database=os.environ["MY_INTEGRATION_DATABASE"])

    with connection.cursor() as cursor:
        cursor.execute("SELECT version();")
        record = cursor.fetchone()
        print("You are connected to - ", record)

except (Exception, psycopg2.Error) as error:
    print ("Error while connecting to database", error)
```

You can now use `connection` and `connection.cursor()` like shown in example above to run queries against the database. Here's how you can run a query and see its output:

```python
import pandas as pd

query = """
SELECT *
FROM users
"""
df = pd.io.sql.read_sql_query(query, connection)
df
```

### Secure connections

PostgreSQL supports [SSL & SSH connections](/docs/secure-connections).
