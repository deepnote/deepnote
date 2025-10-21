---
title: Trino
noIndex: false
noContent: false
coverImage: oHI8e65YQrGA3bwlC6Jj
---

<Callout status="info">
Available on Enterprise plan
</Callout>

With the Trino integration, you can leverage the capabilities of Deepnote's SQL blocks to query your Trino instances at ludicrous speed..

Deepnote's Trino integration allows data teams to efficiently query their data, extract relevant data, and start analyzing and modeling in the comfort of their known notebook environment. In addition, switching between Trino and other distributed SQL engines won't require you to rewrite any SQL statements; all that's needed is switching the SQL block's assigned integration.

### How to connect to Trino

![Deepnote bg (2).png](https://media.graphassets.com/Jf3JIutDQz2aeMMDd0x4)

To create the integration, you'll need a few things:

- **Hostname**: The hostname of the server you are trying to connect to. Check out this section of Trino's docs for more details.
- **Port**: The port on the server of interest you are trying to connect to. Usually, the default is port 8080. Take a look at the Trino docs for more details.
- **Username**: Your username.
- **Password**: The password for the specified username.
- **Database**: The name of the database or catalog you would like to connect to.

### How to use

Once created, you'll be able to connect the Trino integration to any project within your workspace through the right-hand sidebar. The Trino integration comes with custom Trino blocks that help streamline your analytics efforts. You can also convert any existing [SQL block](/docs/sql-cells) to a Trino block.

As with all SQL blocks, the query results will be saved as a Pandas DataFrame and stored in the variable specified in the SQL block.

### Next steps

Jump right into Deepnote & [learn more about SQL blocks in this A/B testing template](https://deepnote.com/launch?template=A/B%20Testing). You can also save yourself some setup work by hitting the `Duplicate` button in the top-right corner to start exploring on your own!

### Secure connections

Deepnote supports securing connections to Trino via optional [SSH tunnels](/docs/secure-connections). We'll automatically secure your connection using SSL when available.
