---
title: "Playbook: rolling Deepnote out across an organization"
description: An admin's path from a pilot team to company-wide use, covering sign-in, membership, roles, groups, default permissions, integrations, AI settings, spending and oversight
noIndex: false
noContent: false
---

Getting one team productive in Deepnote takes an afternoon. Rolling it out to a whole company raises different questions: who can sign in, who gets which role, what new projects are visible to, who connects the databases, what AI can read, and how to keep spending predictable.

This playbook gives workspace admins an order to answer those questions in, from a pilot to company-wide use. Each step links to the page with the details.

## Before you start

Decide on the following and write it down:

- **Who owns the workspace.** The person who creates it becomes its owner and can't be removed from it. Pick a long-lived account. If the owner needs to change later, contact support.
- **Which roles people get.** Admins manage members, integrations and settings. Editors create projects and connect integrations to them. Viewers run notebooks and change input values. Restricted users see only projects shared with them. See [team permissions](/docs/team-permissions).
- **Who creates integrations.** Only admins can create or edit integrations. Editors connect existing integrations to projects.

## Phase 1: pilot

Start with one team and the data it needs.

1. **Create the integrations the pilot needs.** Use a dedicated, read-only database user for each integration rather than a person's credentials. See [least-privilege data access](/docs/playbook-least-privilege-data-access).
2. **Set up the environment.** If the team needs specific packages, build a [custom environment](/docs/custom-environment) once instead of having each project install them.
3. **Choose AI settings.** In **Settings & members** → **AI**, decide whether Deepnote Agent is on, which model it uses, and whether **Provide access to block outputs** is on. Agent can read row-level data only when that setting is on. See [AI data privacy](/docs/ai-data-privacy).
4. **Invite the pilot team** by email.

## Phase 2: sign-in and membership

Before inviting more people, control how they get in.

- **Single sign-on (Enterprise).** Deepnote supports SAML and OIDC, including Okta, Azure AD, Google and OneLogin. Support sets it up with you. See [SSO and directory sync](/docs/sso).
- **Enforce the sign-in provider.** Admins can require everyone in the workspace to sign in with the company's provider, so personal accounts can't join. People invited to a single project still appear as guests.
- **Directory sync (Enterprise).** With SCIM, membership follows your identity provider:
  - People in the `Deepnote Viewers`, `Deepnote Editors`, `Deepnote Admins` and `Deepnote Restricted Users` groups get the matching role. Support can map your existing groups instead.
  - Other groups you sync become Deepnote [user groups](/docs/team-permissions#user-groups) that you can share projects with. Their membership is managed in the identity provider and can't be edited in Deepnote.
  - People removed or deactivated in the directory are removed from the workspace.
- **Domain invites.** Without directory sync, turn on domain invites so that anyone with a company email address can join as a Viewer. Admins then promote people who need to edit.

## Phase 3: structure and default access

Decide what people see by default before the number of projects grows.

1. **Set the default project permission.** In the workspace settings, choose what access workspace members get to new projects. A conservative default, such as **View**, means projects are visible but not editable until their owner opens them up.
2. **Organize projects in folders**, for example one per department, and on Enterprise give each folder its own default project permission. New projects get the default of the nearest folder that sets one. A folder default of **No access** requires private projects to be enabled.
3. **Share with groups, not people.** On Enterprise, share department projects with the department's group, so access follows the directory when people join or leave.
4. **Decide on public sharing.** In the security settings, turn off **Allow apps to be shared publicly** if apps should never be visible outside the company. Turn off **Allow projects to be shared publicly** for projects.

## Phase 4: company-wide use

1. **Publish shared definitions.** Put the company's core metrics in [modules](/docs/modules), so new teams don't start from scratch and Deepnote Agent can use them.
2. **Connect Slack.** Scheduled notebooks can then notify channels, and people can ask the Slack agent to run notebooks. See [Slack](/docs/slack).
3. **Show people how to share results.** Most teams start with [notebook apps](/docs/data-apps) for dashboards and self-serve tools.

## Keep spending predictable

- **Billing alerts.** In **Billing & usage**, set a monthly amount. All admins get an email when pay-as-you-go machine usage reaches it.
- **Pay-as-you-go machines.** You can turn them off for the workspace. Running projects on stronger machines stop immediately and use basic machines on their next start.
- **AI overage limit.** Set a monthly limit for AI usage above your plan's quota, and review token use per person.
- See [billing alerts and limits](/docs/billing-alerts-and-limits) for details.

## Keep an eye on things

- **Usage insights** show who views and runs each notebook and app, so you can retire what nobody uses. See [usage insights](/docs/app-and-notebook-analytics).
- **The audit log (Enterprise)** records actions in the workspace, including membership changes. Admins export it as a CSV from **Settings & members** → **Security**. See [audit log](/docs/audit-log).
- **Database-side auditing.** Every SQL query Deepnote sends carries a comment with the workspace, project and notebook, a link to the project, the email of the person who ran it, and whether a person, a schedule or the API ran it, so your database admins can audit Deepnote traffic in their own tools.

## Plan requirements

| Capability                                                                           | Plan                |
| ------------------------------------------------------------------------------------ | ------------------- |
| Folders, private projects, scheduling, API keys                                      | Team and Enterprise |
| Turning off public app sharing                                                       | Team and Enterprise |
| SSO, enforced sign-in, directory sync, user groups                                   | Enterprise          |
| Folder default permissions, audit log, per-user OAuth integrations, custom AI models | Enterprise          |

## Related

- [Least-privilege data access](/docs/playbook-least-privilege-data-access)
- [When someone leaves](/docs/playbook-when-someone-leaves)
