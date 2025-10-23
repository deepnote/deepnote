---
title: Dremio
noIndex: false
noContent: false
coverImage: vt2HPaxcT3fuNcKXdyNE
---

<Callout status="info">
Available on Enterprise plan
</Callout>

With the Dremio integration, you can leverage the capabilities of Deepnote's SQL blocks to query your Dremio instances at ludicrous speed.

Deepnote's Dremio integration allows data teams to efficiently query their data, extract relevant data, and start analyzing and modeling in the comfort of their known notebook environment. In addition, switching between Dremio and other distributed SQL engines won't require you to rewrite any SQL statements; all that's needed is switching the SQL block's assigned integration.

### How to connect to Dremio

![Dremio_setup.png](https://media.graphassets.com/MyA8JXY1Q5GPsb8CBjJp)

To create the integration, you'll need a few things:

- **Hostname**: The hostname of the server you are trying to connect to. `data.dremio.cloud` for the US control plane, `data.eu.dremio.cloud` for the European control plane.
- **Port**: The port on the server of interest you are trying to connect to. The default port is 443.
- **Schema**: Database schema to use by default when a schema is not specified in a query. However, this does not prevent queries from being issued for other schemas. Such queries must explicitly include the schema.
- **Token**: Personal access token to use when authenticating to Dremio. See Dremio's [docs](https://docs.dremio.com/cloud/security/authentication/personal-access-token/#creating-a-token) for more details.

At the moment this integration only supports connecting to Dremio Cloud, and not to Dremio Software.

### How to use

Once created, you'll be able to connect the Dremio integration to any project within your workspace through the right-hand sidebar. The Dremio integration comes with custom Dremio blocks that help streamline your analytics efforts. You can also convert any existing [SQL block](/docs/sql-cells) to a Dremio block.

As with all SQL blocks, the query results will be saved as a Pandas DataFrame and stored in the variable specified in the SQL block.

### Next steps

Jump right into Deepnote & [learn more about SQL blocks in this A/B testing template](https://deepnote.com/launch?template=A/B%20Testing). You can also save yourself some setup work by hitting the `Duplicate` button in the top-right corner to start exploring on your own!

### Secure connections

Deepnote supports securing connections to Dremio via optional [SSH tunnels](/docs/secure-connections). The Dremio integration always connects via SSL.
