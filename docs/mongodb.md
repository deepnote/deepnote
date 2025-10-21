---
title: MongoDB
noIndex: false
noContent: false
---

<Callout status="info">
Available on Team and Enterprise plans
</Callout>

To add a connection to MongoDB, go to **Integrations** via the left sidebar, create a new MongoDB integration and enter your credentials:

![mongo.png](https://media.graphassets.com/xJmtNalsRLKv245XcPkD)

Don't forget to connect the newly created "MongoDB" integration in the Integrations sidebar.

### Secure connections

Deepnote simplifies connecting to MongoDB via SSH via optional [SSH tunnel integration](/docs/securing-connections?#ssh-tunnel-integration).

#### Troubleshooting SSH connections for MongoDB

If you are encountering the following error

```
Could not reach any servers in X
```

try adding `directConnection=true` to the connection URL.
