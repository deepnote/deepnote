---
title: "Playbook: least-privilege data access"
description: Understand how Deepnote decides what data a person can reach, and combine integration credentials, project access, roles, per-user OAuth and app access so that everyone queries only what they should
noIndex: false
noContent: false
---

Security reviews of a data tool come down to one question: who can see which data? In Deepnote the answer is the combination of two things: the credentials behind each integration, and who has access to the projects that integration is connected to. This playbook explains that model and how to tighten each part.

## How access to data works

1. **Admins create integrations.** Only workspace admins can create or edit a database integration and its credentials.
2. **Editors connect integrations to projects.** Admins and Editors can connect an existing integration to a project or disconnect it.
3. **Project access decides who uses it.** Anyone who can run a project can run the queries already in it. Anyone with **Edit** access can write new queries, which run with the integration's credentials.

So through integrations, a person can reach everything the credentials of the integrations in their projects allow. Project access also shows them whatever is already in the project, such as query results and other outputs. App users of a [data app](/docs/data-app-projects) run its notebook with their own input values, so they reach whatever its queries return for those values, including outputs the page doesn't show. Least privilege means narrowing both sides: credentials and project access.

## Narrow the credentials

- **One integration per level of sensitivity.** Create separate integrations with separate database users, for example "Warehouse analytics" with access to reporting schemas and "Warehouse finance" with access to finance tables. Connect the sensitive one only to the projects that need it. This keeps it out of other projects' queries, but it isn't a boundary for Editors: any Editor can connect any workspace integration to a project they edit. If some Editors must never query the sensitive data, use per-user OAuth or a separate workspace.
- **Read-only database users.** Give integrations used for analysis a database user that can't write, unless a project needs to load data.
- **Per-user OAuth (Enterprise).** With [Snowflake OAuth](/docs/snowflake-oauth), [Snowflake with Okta](/docs/snowflake-with-okta), [Snowflake with Azure AD](/docs/snowflake-with-azure-ad), [BigQuery with Google OAuth](/docs/bigquery-oauth) or Trino with OAuth, there are no shared credentials. Each person signs in with their own account and queries with their own warehouse permissions, including when they use an app. Your warehouse's role model then applies to each person's own queries. It doesn't filter results someone else already produced: a scheduled run uses its owner's credentials, and everyone who can open the notebook sees that run's outputs.
- **Secrets in environment variables.** Store API keys for other services in an [environment variables integration](/docs/environment-variables). Values are stored encrypted. Code in any project the integration is connected to can read them, so connect it only where needed.

Per-user OAuth has one trade-off: a scheduled run uses the OAuth tokens of the schedule's owner, which can expire or be revoked. For schedules that must not fail, use a separate integration with service credentials limited to what the schedule needs.

## Narrow project access

A person's access to a project comes from the most permissive of:

- **Workspace access.** Each project sets what workspace members get: **No access**, which makes it private, **View**, **Comment**, **Execute**, **Edit** or **Full access**. Members never get more than their role allows. Admins have full access to every project except other members' private projects.
- **Direct sharing** with people or, on Enterprise, [groups](/docs/team-permissions#user-groups).
- **Link sharing**, if the project is shared with anyone who has the link. See [sharing projects](/docs/share-projects).

Use them like this:

| Need                                                    | Setting                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everyone can see results, few can change queries        | Workspace access **Execute** or **View**, and **Edit** shared directly with owners                                                                                                                                                                                                        |
| A sensitive project only some people should know exists | A private project shared with those people. Workspace admins can't open other members' private projects                                                                                                                                                                                   |
| People who use results but shouldn't open the project   | **App user** access to a [data app](/docs/data-app-projects) or [Streamlit app](/docs/streamlit-app-projects) project. App users can't open the notebook or the app's code, but they can read every output of their own runs, so keep data they may not see out of the notebook's outputs |
| Contractors who should see only their project           | The **Restricted user** role, plus access to that project                                                                                                                                                                                                                                 |
| Someone outside the company, for one project            | Share the project with them directly. They appear as a guest                                                                                                                                                                                                                              |

Restricted users have no workspace-level access. They see only projects shared with them, with a group they're in, or by link, and can't duplicate or delete projects or change their settings even when shared at a higher level.

## Narrow what AI can see

Deepnote's AI acts as a person. Deepnote Agent and the Slack agent act as the person using them. The Deepnote MCP server acts as whoever signed in, or whoever created the API key it was connected with, so a shared key gives everyone using it that person's access; give each person their own key, or turn on **Enforce OAuth** below. Each surface can only reach projects and data its person can reach. Settings in **Settings & members** → **AI** narrow it further:

- **Provide access to block outputs.** When it's off, Agent doesn't read outputs, including row-level query results. The Slack agent needs it on.
- **MCP access.** Under **MCP connector**, turn off **MCP access** to stop external clients such as Claude, Codex or Cursor from reaching the workspace through the [Deepnote MCP server](/docs/deepnote-mcp). Turn on **Enforce OAuth** to require those clients to sign in with OAuth and block access with API keys. Neither setting affects Deepnote Agent inside Deepnote.
- **Custom AI models (Enterprise).** Route Agent requests to [your own model deployment](/docs/ai-custom-models) instead of Deepnote's providers. Code completions, agent blocks set to a specific built-in model, and the table search Agent runs when writing SQL still go to Deepnote's providers. Turn completions off and leave agent blocks on the default model if no AI traffic may leave your endpoint.

## Restrict sharing outside the company

- In the security settings, turn off **Allow projects to be shared publicly** and, on paid plans, **Allow apps to be shared publicly**.
- On Enterprise, [enforce your sign-in provider](/docs/team-permissions#enforced-sso-provider) so personal accounts can't join the workspace.

## Connect to private networks

- **Allowlist Deepnote's IP addresses** in your database firewall (Team and Enterprise, not during a Team trial).
- **Use SSH** to reach databases that aren't exposed to the internet: the SSH option on a database integration, or the SSH Tunnel integration for other services in your network (Enterprise).
- **Require SSL.** Turn on **Enforce SSL encryption** in the integration's settings so the connection fails rather than going unencrypted, and upload your database's CA certificate to also verify its certificate. Without it, PostgreSQL-based integrations use SSL only when the database offers it.

See [securing connections](/docs/securing-connections).

## Review and audit

- **Before rotating or restricting an integration**, check where it's used. The integration usage endpoints of the [Deepnote API](/docs/api-reference) list the projects, notebooks and blocks that use an integration, except other members' private projects.
- **In your database**, every query from a SQL block carries a comment with the workspace, project and notebook IDs, a link to the project, the email of the person who ran it, and what triggered it, such as a person, a schedule or the API. Use it to review Deepnote traffic in your warehouse's query history. Queries that Python code sends through its own database client don't carry the comment.
- **In Deepnote (Enterprise)**, export the [audit log](/docs/audit-log) from **Settings & members** → **Security**.

## Plan requirements

- **Private projects, Execute-level and App user sharing with individual people, turning off public app sharing:** Pro, Team and Enterprise.
- **IP allowlisting (not during a Team trial) and SSH on database integrations:** Team and Enterprise.
- **Per-user OAuth integrations, user groups, the SSH Tunnel integration, custom AI models, enforced sign-in and the audit log:** Enterprise.

## Related

- [Rolling Deepnote out across an organization](/docs/playbook-rolling-out-deepnote)
- [When someone leaves](/docs/playbook-when-someone-leaves)
- [Team permissions](/docs/team-permissions)
