---
title: Security overview
description: Learn about Deepnote's security and privacy standards that protect your data.
noIndex: false
noContent: false
---

![Security overview](https://media.graphassets.com/fc18e1dd-05bc-4ec0-adf5-fd54a1a940ca)

Deepnote is built on industry-leading security and privacy standards that keep our customer's data secure while connecting, querying, analyzing, and sharing. It offers a secure environment for teams to connect, analyze, and share data without compromising on data protection standards.

As evidence of this, we've earned our SOC 2 Type II certification — a rigorous, third-party validation that our security practices and processes are built to meet the highest standards.

Visit [https://deepnote.com/security](https://deepnote.com/security) for more detail on Deepnote's Security and Compliance posture.

### Data security is core to how we work

At Deepnote, security isn't just a feature — it's foundational to how we build and operate. From day one, every team member is trained on security best practices, with clear accountability for protecting customer data and privacy. We embed security deep into our workflows, aligning with the standards required for SOC 2 compliance.

We invest heavily in proactive defenses, including regular third-party penetration testing and a [private bug bounty program](https://deepnote.com/.well-known/security.txt), to stay ahead of emerging threats. Security is everyone's job at Deepnote — and we take it seriously.

### Analyze without extracting

Deepnote powers your work through live queries directly against your data sources — no unnecessary extraction, duplication, or downloads to local machines. Forget about scattered .csv files, outdated Excel exports, or risky third-party storage. With Deepnote, data stays exactly where it belongs: securely in your warehouse, accessed only when needed.

Inside projects, data is ephemeral by design — living just long enough in memory to power your analysis, then disappearing. [Our configurable caching](/docs/sql-query-caching) lets you fine-tune query costs without forcing long-term data storage or security trade-offs. Minimal movement, maximum control.

### Architecture

Deepnote's workspace is architected from day one with security at the core. Database credentials are encrypted at rest and stored securely in a vault, never exposed in plain text. When you run a query, Deepnote connects live to your data source, returns results into an isolated execution environment, and optionally caches results — always under your control.

Workspace admins have full control over access policies — managing who can connect to databases, who can view or edit projects, and how data is shared across teams. Fine-grained permissions meet enterprise-grade security, without adding friction to your workflow.

### Product access controls

Deepnote supports secure authentication out of the box, with [full SSO integrations](/docs/sso) for Google Workspace, Okta, and any OIDC-compliant provider.

Our access model is built to meet the needs of teams handling sensitive data — whether for GDPR compliance, sector-specific regulations, or internal security policies. Deepnote's flexible controls give you precision over who can see, query, and collaborate on your projects.

Access management in Deepnote breaks down into three key layers:

- **User Roles**: Define what actions users can take inside Deepnote — from editing notebooks to managing workspace settings — with smart defaults and customizable role assignment.
- **Data Access**: Control who can connect to which databases. Limit users to pre-approved connections or credentials, minimizing risk and exposure.
- **Project Access**: Fine-tune who can view, edit, or publish projects and apps, putting full control over logic, outputs, and shared insights into the right hands.

Security isn't an afterthought at Deepnote — it's baked into every layer of the product.

### Deployment options

Deepnote offers flexible deployment models to meet your team's needs — from secure multi-tenant cloud hosting to dedicated single-tenant deployments for organizations with stricter compliance or privacy requirements. For specialized hosting (like region-specific data residency or private VPC deployment), reach out to us directly at [sales@deepnote.com](mailto:sales@deepnote.com) — we'll tailor the best setup for you.

### What data does Deepnote store?

Deepnote leverages AWS for processing and storage, with security baked in at every layer. Data at rest — including database credentials, file uploads, and cached query results — is encrypted using AES 256-bit encryption. Data in transit is protected with TLS 1.2 or higher, securing network traffic between Deepnote's servers and your browser. Your data stays safe, wherever it moves.

Additionally, an encrypted temporary copy of users' workspace data can be stored on other compute providers' machines. AWS is used for long-term data storage.

### Does Deepnote use customer data to train, fine-tune, or otherwise improve any AI/ML models?

No, Deepnote does not use customer data to train, fine-tune, or otherwise improve any AI or ML models. Deepnote integrates external AI services (such as OpenAI and Anthropic) via secured APIs under enterprise agreements that explicitly prohibit training on customer data. No personal, sensitive, or project data is sent to model providers by default, and zero-data retention agreements are in place for Anthropic (30-day retention for OpenAI under strict protections).

Deepnote itself does not host or fine-tune any models internally, and all customer data remains encrypted (AES-256), stored within the customer's AWS environment, and protected under SOC 2 Type II-certified security practices with full user control. AI features are assistive only, optional, and fully transparent, ensuring that customer data privacy, GDPR compliance, and security standards are upheld at all times.

### Support

For all customers, Deepnote provides technical support via Intercom and email weekdays from 9 am to 5 pm Pacific Time as a minimum. Support via Slack channel may also be provided upon request.
