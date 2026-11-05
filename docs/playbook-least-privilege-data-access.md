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

So the data a person can reach is everything the credentials of the integrations in their projects allow. Least privilege means narrowing both sides: credentials and project access.

## Narrow the credentials

- **One integration per level of sensitivity.** Create separate integrations with separate database users, for example "Warehouse analytics" with access to reporting schemas and "Warehouse finance" with access to finance tables. Connect the sensitive one only to the projects that need it.
- **Read-only database users.** Give integrations used for analysis a database user that can't write, unless a project needs to load data.
- **Per-user OAuth (Enterprise).** With [Snowflake OAuth](/docs/snowflake-oauth), [Snowflake with Okta](/docs/snowflake-with-okta), [Snowflake with Azure AD](/docs/snowflake-with-azure-ad) or [BigQuery with Google OAuth](/docs/bigquery-oauth), there are no shared credentials. Each person signs in with their own account and queries with their own warehouse permissions, including when they use an app. Your warehouse's role model then applies in Deepnote unchanged.
- **Secrets in environment variables.** Store API keys for other services in an [environment variables integration](/docs/environment-variables). Values are stored encrypted. Code in any project the integration is connected to can read them, so connect it only where needed.

Per-user OAuth has one trade-off: a scheduled run uses the OAuth tokens of the schedule's owner, which can expire or be revoked. For schedules that must not fail, use a separate integration with service credentials limited to what the schedule needs.

## Narrow project access

A person's access to a project comes from the most permissive of:

- **Workspace access.** Each project sets what workspace members get: **View**, **Comment**, **Execute** or **Edit**. Members never get more than their role allows, and admins always have full access.
- **Direct sharing** with people or, on Enterprise, [groups](/docs/team-permissions#user-groups).
- **Link sharing**, if the project is shared with anyone who has the link. See [sharing projects](/docs/share-projects).

Use them like this:

| Need                                                    | Setting                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Everyone can see results, few can change queries        | Workspace access **Execute** or **View**, and **Edit** shared directly with owners                      |
| A sensitive project only some people should know exists | A private project shared with those people. Workspace admins can't open other members' private projects |
| People who use results but shouldn't see queries        | **App user** access to the project, and **Hide code blocks** in the app                                 |
| Contractors who should see only their project           | The **Restricted user** role, plus access to that project                                               |
| Someone outside the company, for one project            | Share the project with them directly. They appear as a guest                                            |

Restricted users have no access to workspace projects unless a project is shared with them directly, and can't duplicate or delete projects or change their settings even when shared at a higher level.

## Narrow what AI can see

Deepnote's AI acts as the person using it. Deepnote Agent, the Slack agent and the Deepnote MCP server can only reach projects and data that person can reach. Settings in **Settings & members** → **AI** narrow it further:

- **Provide access to block outputs.** When it's off, Agent doesn't read outputs, including row-level query results. The Slack agent needs it on.
- **MCP access.** Under **MCP connector**, turn off **MCP access** to stop external clients such as Claude, Codex or Cursor from reaching the workspace through the [Deepnote MCP server](/docs/deepnote-mcp). Turn on **Enforce OAuth** to require those clients to sign in with OAuth and block access with API keys. Neither setting affects Deepnote Agent inside Deepnote.
- **Custom AI models (Enterprise).** Route requests to [your own model deployment](/docs/ai-custom-models) instead of Deepnote's providers.

## Restrict sharing outside the company

- In the security settings, turn off **Allow projects to be shared publicly** and, on Team and Enterprise, **Allow apps to be shared publicly**.
- On Enterprise, [enforce your sign-in provider](/docs/team-permissions#enforced-sso-provider) so personal accounts can't join the workspace.

## Connect to private networks

- **Allowlist Deepnote's IP addresses** in your database firewall (Team and Enterprise).
- **Use an SSH tunnel** to reach databases that aren't exposed to the internet (Enterprise).
- **Encrypt connections with SSL.**

See [securing connections](/docs/securing-connections).

## Review and audit

- **Before rotating or restricting an integration**, check where it's used. The integration usage endpoints of the [Deepnote API](/docs/api-reference) list the projects, notebooks and blocks that use an integration.
- **In your database**, every query from Deepnote carries a comment with the workspace, project and notebook, a link to the project, the email of the person who ran it, and whether a person, a schedule or the API ran it. Use it to review Deepnote traffic in your warehouse's query history.
- **In Deepnote (Enterprise)**, export the [audit log](/docs/audit-log) from **Settings & members** → **Security**.

## Plan requirements

- **Private projects, Execute-level and App user sharing with individual people, IP allowlisting, turning off public app sharing:** Team and Enterprise.
- **Per-user OAuth integrations, user groups, SSH tunnels, custom AI models, enforced sign-in and the audit log:** Enterprise.

## Related

- [Rolling Deepnote out across an organization](/docs/playbook-rolling-out-deepnote)
- [When someone leaves](/docs/playbook-when-someone-leaves)
- [Team permissions](/docs/team-permissions)
