---
title: Semantic layer
noIndex: false
noContent: false
---

As your data team grows, a semantic layer becomes a useful abstraction to help you to create a consistent and unified view of your key metrics across the entire organization. It ensures that every analysis your do uses the same definitions when calculating complex metrics (e.g. _How many users do we have? What was our revenue in the last fiscal year?_).

**Deepnote is compatible with all major approaches to building a semantic layer.** In this article, we will cover different approaches and how to integrate them with Deepnote.

### Building a semantic layer in a notebook

Deepnote is a great place to define your metrics, and with the new **modules** feature, creating a semantic layer has never been easier. This approach is recommended for teams of all sizes who want to ensure consistent metric definitions across their organization.

We recommend creating a separate notebook for each metric definition. Use SQL or Python blocks to retrieve the data and text blocks to document each metric and its change history. Then publish these notebooks as modules that can be imported into any analysis.

![2025-03-11 17.39.25 (1) (1).gif](https://media.graphassets.com/jzB9hGk4Ti6nJMtLCEkT)

Modules ensure that everyone on your team calculates metrics the same way, eliminating inconsistencies and building trust in your data. When a metric definition needs to be updated, you only need to change it in one place, and the update propagates automatically to all notebooks using that module.

Learn more about [how to use modules](https://deepnote.com/docs/modules) and check out our [detailed example](https://deepnote.com/blog/modules) of building a semantic layer with modules.

### dbt Semantic Layer

You can use dbt or any other data warehouse-based semantic layers directly from Deepnote. dbt exposes a [JDBC interface](https://docs.getdbt.com/docs/dbt-cloud-apis/sl-jdbc), allowing you to query dbt models via SQL.

Integration with the dbt Semantic Layer is on our roadmap. We're working on deeper native integration to make this experience even more seamless.
If you'd like to influence the development of this feature, please vote and comment on this [portal card](https://portal.productboard.com/deepnote/1-deepnote-product-portal/c/159-dbt-semantic-layer-metricflow-integration).

### Looker and LookML

Looker also exposes a [JDBC interface](https://cloud.google.com/looker/docs/sql-interface), allowing you to query LookML models via SQL.Native integration with Looker and LookML is on our product roadmap. To help us prioritize this integration, you can vote and share your use case on this [portal card](https://portal.productboard.com/deepnote/1-deepnote-product-portal/c/162-lookml-integration).

Get in touch with us at [sales@deepnote.com](mailto:sales@deepnote.com) to learn more about these integrations.
