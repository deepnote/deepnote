---
title: Microsoft SQL Server (Azure SQL)
noIndex: false
noContent: false
coverImage: YQvXj1YT9iNvZcBvu1QK
---

<Callout status="info">
Available on Team and Enterprise plans
</Callout>

With the SQL Server integration, you can leverage the capabilities of Deepnote's [SQL blocks](/docs/sql-cells) to query your SQL Server instances. **But wait, there's more!** Using the SQL Server integration, you can actually connect to SQL Server, Azure SQL, as well as Azure Synapse. That way, regardless of which Microsoft product you prefer, you'll be able to connect natively through Deepnote.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FcVlARDHsJZRaOa8ROQI3%2FCleanShot%202022-07-29%20at%2018.12.27%402x.png](https://media.graphassets.com/tM3NVcYQS7qzdJG0cVfp)

Deepnote's SQL Server integration allows data teams to efficiently query their data, extract relevant data, and start analyzing and modeling in the comfort of their known notebook environment. In addition, switching between Azure SQL, SQL Server, and Azure Synapse, won't require you to rewrite any SQL statements; all that's needed is switching the SQL block's assigned integration.

### How to connect to SQL Server (or Azure SQL, or Azure Synapse)

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FtzGi0pWdvxAFWs9CrTft%2Fss1.gif](https://media.graphassets.com/w3Z8ghDrS2qz0XqK8BNh)

To create the integration, you'll need a few things:

- **Hostname**: The hostname of the server you are trying to connect to. Check out [this section](https://docs.microsoft.com/en-us/sql/connect/jdbc/building-the-connection-url?view=sql-server-ver16) of Microsoft's docs for more details.
- **Port**: The port on the server of interest you are trying to connect to. Usually, the default is port 1433. Take a look at the [Microsoft SQL Server docs](https://docs.microsoft.com/en-us/sql/connect/jdbc/building-the-connection-url?view=sql-server-ver16) for more details.
- **Username**: Your username. More in Microsoft's docs [here](https://docs.microsoft.com/en-us/sql/t-sql/functions/user-name-transact-sql?view=sql-server-ver16).
- **Password**: The password for the specified username.
- **Database**: The name of the database you would like to connect to.

<Callout status="info">

If your connection is protected, you might need to add Deepnote's IP addresses to your allowlist. [Read more here](/docs/authorize-deepnote-ip-addresses).

</Callout>

### How to use

Once created, you'll be able to connect the SQL Server integration to any project within your workspace through the right-hand sidebar. The SQL Server integration comes with custom SQL Server SQL blocks that help streamline your analytics efforts. You can also convert any existing [SQL block](/docs/sql-cells) to a SQL Server block.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2F5hjLnlfp2xfKhRqkaejm%2Fss2.gif](https://media.graphassets.com/QMu1OTdTS2mCtOhgHB4A)

As with all SQL blocks, the query results will be saved as a Pandas DataFrame and stored in the variable specified in the SQL block.

### Next steps

Jump right into Deepnote & [learn more about SQL blocks in this A/B testing template](https://deepnote.com/launch?template=A/B%20Testing). You can also save yourself some setup work by hitting the `Duplicate` button in the top-right corner to start exploring on your own!

### Secure connections

Deepnote supports securing connections to Microsoft SQL Server via optional [SSH tunnels](/docs/secure-connections). We'll automatically secure your connection using SSL when available.
