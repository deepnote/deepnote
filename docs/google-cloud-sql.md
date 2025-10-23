---
title: Google Cloud SQL
description: Google Cloud SQL is a fully managed, relational database service offered by Google Cloud Platform. It enables users to deploy, maintain, and scale relational databases like MySQL, PostgreSQL, and SQL Server without the need to manage underlying infrastructure. With built-in security, high availability, and automated backups, it simplifies database management and allows developers to focus on building applications.
noIndex: false
noContent: false
coverImage: hlTbNZksRS2T2iUCAZ2T
---

## What can you do with Google Cloud SQL

Google Cloud SQL is a fully managed, relational database service offered by Google Cloud Platform. It enables users to deploy, maintain, and scale relational databases like MySQL, PostgreSQL, and SQL Server without the need to manage underlying infrastructure. With built-in security, high availability, and automated backups, it simplifies database management and allows developers to focus on building applications.

And you are now available to connect in Deepnote!

### How to connect to Google Cloud SQL

#### Google Cloud Platform

1. Enable `Cloud SQL`, and `Cloud SQL Admin API`.
2. Create an instance on your project, Deepnote supports all available options (postgres, mysql, sql-server) in Cloud SQL.
3. Create a database and a user and password with access to that DB
4. Create a Service account with access to your Project. [Click here for a guide on creating a JSON service account key](https://cloud.google.com/docs/authentication/getting-started).

#### Authenticating with a service account

A service account will provide a shared connection to Google Cloud SQL. That is, all collaborators will be able run queries against databases provisioned in the service account. Your service account key will be encrypted and stored in Deepnote's database.

**Make sure to enable Cloud SQL and Cloud SQL API Admin for your GCP project.** The service account needs sufficient permissions for the resources you want to use. If the authorisation process fails, we recommend visiting the Cloud SQL [access control page](https://cloud.google.com/sql/docs/mysql/iam-permissions).

### Connecting to your Instance

Now that you have connected our integration, simply query the database with Python.

You still need to install an appropriate the appropriate [Google Cloud SQL Connector](https://github.com/GoogleCloudPlatform/cloud-sql-python-connector).

**After installing your connector, you must restart your notebook**

MySQL:

`pip install "cloud-sql-python-connector[pymysql]"`

Postgres:

`pip install "cloud-sql-python-connector[pg8000]"`

SQL Server:

`pip install "cloud-sql-python-connector[pytds]"`

After installing, especially with SQL server, we may have some dependency mismatches. The usual suspects can be solved with:

`!pip install python-tds`

`!pip install pyopenssl --upgrade`

`!pip install sqlalchemy-pytds`

Replace all connection string information with appropriate values.

Replace the `YOUR_INTEGRATION_NAME` with an uppercased, underscore-connected name of your integration.

MySQL

```python
from google.cloud.sql.connector import Connector
  import sqlalchemy
  import pymysql
  from google.oauth2 import service_account
  from google.cloud import spanner
  import json

  cloud_sql_credentials = service_account.Credentials.from_service_account_info(
      json.loads(os.environ['YOUR_INTEGRATION_NAME_SERVICE_ACCOUNT']))

  # initialize Connector object
  connector = Connector(credentials=cloud_sql_credentials)

  # function to return the database connection
  def getconn() -> pymysql.connections.Connection:
      conn: pymysql.connections.Connection = connector.connect(
          "project:region:instance",
          "pymysql",
          user="my-user",
          password="my-password",
          db="my-db-name"
      )
      return conn

  # create connection pool
  pool = sqlalchemy.create_engine(
      "mysql+pymysql://",
      creator=getconn,
  )
```

Postgres

```python
from google.cloud.sql.connector import Connector
  import sqlalchemy
  import pymysql
  from google.oauth2 import service_account
  from google.cloud import spanner
  import json

  cloud_sql_credentials = service_account.Credentials.from_service_account_info(
      json.loads(os.environ['YOUR_INTEGRATION_NAME_SERVICE_ACCOUNT']))

  # initialize Connector object
  connector = Connector(credentials=cloud_sql_credentials)

  # function to return the database connection
  def getconn() -> pymysql.connections.Connection:
      conn: pymysql.connections.Connection = connector.connect(
          "project:region:instance",
          "pg8000",
          user="my-user",
          password="my-password",
          db="my-db-name"
      )
      return conn

  # create connection pool
  pool = sqlalchemy.create_engine(
      "postgresql+pg8000://",
      creator=getconn,
  )
```

SQL Server

```python
import os
from google.cloud.sql.connector import Connector
from google.oauth2 import service_account
import pytds
import json
import sqlalchemy

cloud_sql_credentials = service_account.Credentials.from_service_account_info(
    json.loads(os.environ['YOUR_INTEGRATION_NAME_SERVICE_ACCOUNT']))


def connect_with_connector() -> sqlalchemy.engine.base.Engine:

    connector = Connector(credentials=cloud_sql_credentials)

    def getconn() -> pytds.Connection:
        conn = connector.connect(
            "project:region:instance",
            "pytds",
            user='sqlserver',
            password='password',
            db='db-name',

        )
        return conn

    pool = sqlalchemy.create_engine(
        "mssql+pytds://",
        creator=getconn,
    )
    return pool

pool = connect_with_connector()


```

### Working with data from Google Cloud SQL

Now that you are connected to your Google Cloud SQL you can do the following actions in Deepnote:

- Explore column distributions as well as the sorting and filtering capabilities on the results set. All results are displayed as an interactive Pandas DataFrame. [Click here to learn about interactive DataFrame output](variable-explorer#interactive-dataframe-output).

- Pipe the results of your query into a chart block for rapid interactive data visualization. [Click here to learn more about chart blocks](chart-blocks).
