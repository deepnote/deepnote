---
title: ClickHouse
noIndex: false
noContent: false
coverImage: aG5RlzU4QOg6HRkPCqw3
---

<Callout status="info">
**Want to get started right away?** Jump right into Deepnote and start exploring using our ClickHouse template [here](https://deepnote.com/launch?template=ClickHouse%20and%20Deepnote).
</Callout>

With the [ClickHouse](https://clickhouse.com/) integration, you can leverage the performance and scalability that comes with ClickHouse's open-source column-oriented DBMS right from within Deepnote. ClickHouse allows users to handle thousands of sub-second queries per second on petabyte-scale datasets. If you need to run fast queries against (very) large datasets, ClickHouse is for you.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FXbgKCh6PkMKJPId0qLPD%2FCleanShot%202022-05-31%20at%2011.28.08%402x.png](https://media.graphassets.com/mwvnyIVZRVCzds7ZXk2E)

Deepnote's ClickHouse integration allows data teams to efficiently query very large datasets, extract relevant data, and start analyzing and modeling in the comfort of their known notebook environment.

### How to connect

To create a ClickHouse integration in Deepnote, open up the integrations overview and click on the ClickHouse tile.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FvlXvYvUYtEz0sTbDBcWt%2FScreen-Recording-2022-05-31-at-2%20(1).gif](https://media.graphassets.com/EbN8UwFNTLaUdL6mYlGM)

To create the integration, you'll need a few things:

- **Hostname**: The hostname of the server you are trying to connect to. [Check out this section](https://clickhouse.com/docs/en/sql-reference/functions/other-functions/#hostname) of ClickHouse's docs for more details.
- **Port**: The port on the server of interest you are trying to connect to. Luckily, [ClickHouse's docs ](https://clickhouse.com/docs/en/sql-reference/functions/other-functions/#getserverport)offer concrete steps for this one as well.
- **Username**: Your username. More in ClickHouse's docs [here](https://clickhouse.com/docs/en/operations/settings/settings-users/#user-namepassword).
- **Password**: The password for the specified username. More details [here](https://clickhouse.com/docs/en/operations/settings/settings-users/#user-namepassword).
- **Database**: The name of the database you would like to connect to.

<Callout status="info">
If your connection is protected, you might need to allowlist Deepnote's IP addresses. [Read more here](/docs/authorize-deepnote-ip-addresses).
</Callout>

### How to use

Once created, you'll be able to connect the ClickHouse integration to any project within your workspace through the right-hand sidebar. The ClickHouse integration comes with custom ClickHouse SQL blocks that help streamline your analytics efforts. You can also convert any existing [SQL block](/docs/sql-cells) to a ClickHouse block.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FXEq6NlDbyPYBkypornU9%2FMy-Moviee.gif](https://media.graphassets.com/GwYoEpMdRYiuJyACFz9T)

As with all SQL blocks, the query results will be saved as a DataFrame and stored in the variable specified in the SQL block.

### Next steps

Jump right into Deepnote &[ learn more about SQL blocks in this A/B testing template](https://mail.deepnote.com/e/c/eyJlbWFpbF9pZCI6IlJJU0VCZ01BQVgxX0E5QWFNWGJ0R3Q2YzFGVXlrZz09IiwiaHJlZiI6Imh0dHBzOi8vZGVlcG5vdGUuY29tL2xhdW5jaD90ZW1wbGF0ZT1BL0IlMjBUZXN0aW5nXHUwMDI2dXRtX3NvdXJjZT1wcm9kdWN0X3VwZGF0ZXNcdTAwMjZ1dG1fbWVkaXVtPWVtYWlsXHUwMDI2dXRtX2NhbXBhaWduPXRlbXBsYXRlc19wcm9tbyIsImludGVybmFsIjoiODQ4NDA2MDFiNTFjZTY4NjAyIiwibGlua19pZCI6NDc1fQ/e578c32db11e3a419a2b3185b2cc15dade67e66d74254451171a351513b18bfa)[.](https://deepnote.com/workspace/Deepnote-Templates-71742312-24f2-4c10-9bf7-786d17280b92/project/Machine-Learning-With-SQL-c626fd30-cb3f-4eae-ac70-c9c4a4f626eb/%2Fmindsdb_demo.ipynb) You can also save yourself some setup work by hitting the `Duplicate` button in the top-right corner to start exploring on your own!

### Secure connections

Deepnote supports securing connections to ClickHouse via optional [SSH tunnels](/docs/secure-connections).
