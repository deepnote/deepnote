---
title: Securing connections
description: Data is the core of your work in Deepnote — that's why we prioritize keeping it safe. Here's how to secure connections to your data and ensure end-to-end privacy.
noIndex: false
noContent: false
---

## Connecting to databases on private networks

You can choose one of two ways to authorize Deepnote to connect to your database. You can authorize the set of IP addresses that Deepnote uses to connect or you can connect using an SSH tunnel.

### Authorizing Deepnote's IP addresses

<Callout status="info">

Authorizing Deepnote's IP addresses is only available on the [**Team plan**](https://deepnote.com/pricing) and the [**Enterprise plan**](https://deepnote.com/pricing), excluding Team Trial periods. Authorizing Deepnote's IP addresses is not available on the Education plan.

</Callout>

Deepnote has fixed IP addresses you will need to authorize.

```
107.22.50.0
18.214.47.38
3.217.84.43
3.229.1.246
3.230.201.213
44.216.70.44
52.21.216.28
52.55.205.54
54.144.37.244
54.165.20.26
54.235.42.8
54.242.142.100
138.199.245.32
138.199.245.36
148.251.31.233
```

Here are quick-start guides for changing the firewall/security settings:

- [Deepnote's Google Cloud guide for GCP Cloud Postgres](https://deepnote.com/@deepnote/Static-IP-addresses-wsfusHNVQUWlAPHzuoDXFQ)
- [AWS](https://docs.aws.amazon.com/vpc/latest/userguide/security.html)
- [Google Cloud ](https://cloud.google.com/vpc/docs/firewalls)
- [Snowflake](https://docs.snowflake.com/en/user-guide/network-policies.html)

### Using SSH to connect to your data

You can connect to selected data warehouses and database integrations via a secure SSH tunnel that is configurable in the **Integrations** menu. Deepnote automatically generates a public SSH key for your workspace that you can add it to the authorized keys file (`~/.ssh/authorized_keys`) on your SSH bastion.

![ssh_db.png](https://media.graphassets.com/8w7FUd7gQzOWJHHUTp5f)

If you query a database with SSH configured from an SQL block, Deepnote will automatically create an SSH tunnel.

The following Integrations support SSH tunnels:

- PostgreSQL
- Microsoft SQL Server
- Amazon Redshift
- MongoDB
- MySQL
- ClickHouse
- MindsDB
- MariaDB
- Dremio
- Trino

### SSH Tunnel integration

<Callout status="info">
The feature is available on the Enterprise plan.
</Callout>

The SSH Tunnel integration allows you to securely connect to resources in your private network. For example, you may want to connect to an experiment tracking tool (such as MLflow), a database without native integration in Deepnote (such as Redis), or a feature store (such as Feast) hosted on your network.

Deepnote automatically generates a public SSH key for your workspace. You can copy it from the SSH tunnel integration modal and add it to the authorized keys file (~/.ssh/authorized_keys) on your SSH bastion.

When you connect the integration to the project, the SSH tunnel starts in the background and exposes the host and port that you can use to access your data. Here's an example, along with code that demonstrates how to use the SSH Tunnel integration to query a private API that provides daily candles for a given ticker.

![ssh-tunnel-integration](https://media.graphassets.com/zzHYzL5ARd2FiVaE9t2s)

```python

import os
import requests

# Get the local host and port from environment variables
# Note – you may need to change the variable names as they contain the integration name
HOST = os.environ['MY_SSH_TUNNEL_LOCAL_HOST']
PORT = os.environ['MY_SSH_TUNNEL_LOCAL_PORT']

# Set up the URL for the API endpoint
url = f'http://{HOST}:{PORT}/daily-candles/XYZ'

# Make the API request
response = requests.get(url)

# Print the response content
print(response.content)
```

To find the environment variable names for your integration, you can open the three-dot menu of the integration in the right sidebar and click "How to use".

![SSH.png](https://media.graphassets.com/OFXUnZSI2YGRu8cJAhIQ)

In order to use SSH to connect to SQL databases with a native integration in Deepnote we recommend using the integration setting.

### Workspace SSH key

Deepnote automatically generates an SSH private/public key pair for your workspace. The private key is stored securely in Deepnote and used when authenticating an SSH connection from an [SQL block](/docs/sql-cells). The workspace SSH key is the same for all integrations within that workspace, simplifying deployment when multiple data sources are secured behind the same bastion.

## Encrypting your connections with SSL

All database and warehouse integrations support encrypted connections via SSL to make sure your data travels safely over the internet.

Fully managed data warehouses such as Snowflake, Google BigQuery, and Amazon Redshift will have SSL enabled by default. Databases such as Postgres, MySQL, and Microsoft SQL Server may require additional configuration.

By default, Deepnote will always connect using the `preferred` mode. It will try to use SSL if the database is configured to use it, but it will fall back to an unencrypted connection if not.

To make sure SSL is used, enable the setting when creating a new integration or editing an existing one. This will put the connection in `required` mode. In this state, encryption is enforced but the certificate of the server is not validated. If the database is not configured to use SSL, the connection will fail.

![required_ssl.png](https://media.graphassets.com/P9zPUr1mTt2SzMJ3lUwP)

To run in `strict` mode, you can upload a CA Certificate for your database or warehouse. We'll verify that the server's certificate is valid.

![strict_ssl.png](https://media.graphassets.com/1O7BvaAyQwa42wvkPvT2)
