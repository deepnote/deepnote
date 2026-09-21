---
title: Security overview
description: Learn about Deepnote's security and privacy standards that protect your data.
noIndex: false
noContent: false
---

Deepnote uses security and privacy controls to protect customer data while teams connect, query, analyze, and share it.

Deepnote has earned SOC 2 Type II certification, which provides third-party validation of its security practices and processes.

Visit the [Deepnote Trust Center](https://deepnote.com/security) for details about security and compliance.

## Data security is core to how we work

Deepnote trains each team member on security practices and makes them accountable for protecting customer data and privacy. Our workflows follow the standards required for SOC 2 compliance.

Deepnote commissions third-party penetration tests and runs a [private bug bounty program](https://deepnote.com/.well-known/security.txt).

## Analyze without extracting

Deepnote queries your data sources live. You don't need to extract or duplicate data or download it to a local machine. The source data stays in your warehouse until a query needs it.

Projects keep data in memory while an analysis runs. [Configurable caching](/docs/sql-query-caching) lets you control query costs and how long Deepnote stores query results.

## Architecture

Deepnote encrypts database credentials at rest and stores them in a vault instead of exposing them as plain text. When you run a query, Deepnote connects to the data source and returns the results to an isolated execution environment. Deepnote caches results when you enable caching.

Workspace admins manage who can connect to databases, view or edit projects, and share data across teams.

## Product access controls

Deepnote supports [single sign-on integrations](/docs/sso) for Google Workspace, Okta, and any provider that supports OpenID Connect (OIDC).

Teams can use access controls to meet General Data Protection Regulation (GDPR) requirements, sector-specific regulations, or internal security policies. These controls determine who can see, query, and collaborate on projects.

Access management in Deepnote breaks down into three key layers:

- **User roles:** Define which actions users can take, from editing notebooks to managing workspace settings.
- **Data access:** Control which databases each user can connect to. You can limit users to pre-approved connections or credentials.
- **Project access:** Control who can view, edit, or publish projects and apps.

## Deployment options

Deepnote offers multi-tenant cloud hosting and dedicated single-tenant deployments. Contact [sales@deepnote.com](mailto:sales@deepnote.com) to discuss region-specific data residency or deployment in a virtual private cloud (VPC).

## What data does Deepnote store?

Deepnote uses Amazon Web Services (AWS) for processing and storage. Deepnote encrypts database credentials, file uploads, and cached query results at rest with 256-bit Advanced Encryption Standard (AES) encryption. Transport Layer Security (TLS) 1.2 or higher protects data in transit between Deepnote's servers and your browser.

Other compute providers may store an encrypted temporary copy of workspace data. Deepnote uses AWS for long-term data storage.

## Does Deepnote use customer data to train, fine-tune, or otherwise improve any AI/ML models?

No. Deepnote does not use customer data to train, fine-tune, or improve AI or machine learning models. Deepnote connects to external AI services such as OpenAI and Anthropic through secured APIs under enterprise agreements that prohibit training on customer data. Deepnote does not send personal, sensitive, or project data to model providers by default. Anthropic has a zero-data retention agreement, while OpenAI retains data for 30 days under its agreement.

Deepnote does not host or fine-tune models. Deepnote encrypts customer data with AES-256, stores it in the customer's AWS environment, and applies its SOC 2 Type II-certified security practices. Customers choose whether to use the AI features.

## Support

Deepnote provides technical support through Intercom and email on weekdays from 9 a.m.-5 p.m. PT. Customers can also request support through a Slack channel.
