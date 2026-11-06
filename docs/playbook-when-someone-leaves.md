---
title: "Playbook: when someone leaves"
description: What happens to schedules, API keys, private projects and OAuth connections when a member leaves a Deepnote workspace or changes role, and a checklist so that nothing important stops silently
noIndex: false
noContent: false
---

Scheduled runs and API calls in Deepnote run as a person. A schedule runs as its owner, and an API key acts as the person who created it. An automation can therefore never do more than its owner could, but it's affected when that person leaves or changes role.

This playbook explains what happens, and gives a checklist for handing over someone's work before and after they go.

## What happens automatically

| When                                                                           | What Deepnote does                                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| A member is removed from the workspace, manually or by directory sync          | Every schedule they own is paused immediately                                            |
| A member's role changes to one that can't schedule, such as Viewer             | Every schedule they own is paused immediately. Only Admins and Editors can own schedules |
| A schedule's owner is deactivated or suspended, or loses access to the project | The schedule is paused the next time it's due to run                                     |
| An API key's creator leaves the workspace, or is deactivated or suspended      | The key stops working on its next request                                                |

A paused schedule keeps its timing and notification settings. Deepnote emails the schedule's owner and, unless the project is private, the workspace admins. Through the API, `GET /v2/notebooks/{notebookId}/schedule` reports the schedule as paused with the reason `access-revoked`.

No new scheduled run starts, and no new API request is accepted, as a person who has left, so their access isn't silently used from then on.

## Resuming a paused schedule

An Admin or Editor with access to the project opens the schedule and saves it. Saving makes them the schedule's owner and resumes it. From then on, the schedule runs with **their** permissions and, for integrations that use per-user OAuth, **their** OAuth sign-in.

Before saving, check that the new owner:

- Has at least Execute access to the project and to any [modules](/docs/modules) the notebook imports.
- Has signed in to every per-user OAuth integration the notebook uses, such as [Snowflake OAuth](/docs/snowflake-oauth) or [BigQuery with Google OAuth](/docs/bigquery-oauth), and has access to the same tables.

## Checklist

### Before they leave

1. **List their schedules.** Ask them to list the notebooks they've scheduled, or check the notification emails each schedule sends. Agree who takes over each one, then have the new owner open and save it while the original owner is still around to answer questions.
2. **Replace their API keys.** In **Settings & members** → **Security** → **API keys**, the list shows who created each key and when it was last used. Find the keys they created. Create replacement keys from the new owner's account. Each key acts as its creator, so first check that the new owner has access to every project the systems use, at the permission level they need, and no more. Compare workspace roles as well as project access: an Admin's key can create integrations, for example, and an Editor's can't. In short, a key from someone with broader access widens what those systems can reach, and a `deepnote sync` job then mirrors every project that account can open. Prefer an account whose access matches the systems' needs, and preview a sync before running it. A sync with `--prune` treats a tracked project that the new key can't see as deleted and removes its local folder, so run the job once with `--dry-run` and its usual flags, and check which projects it would prune. Update the systems, test them with the new keys, then delete the old keys.
3. **Move private work.** Workspace admins can't open other members' private projects. Ask them to share anything worth keeping with the workspace or a teammate before they go.
4. **Hand over integrations they set up.** If a project relies on credentials tied to them personally, for example an environment variable holding their own API token, replace it with a service credential.
5. **Hand over apps and metric definitions they maintain.** Give someone else Edit access to those projects.

### After they leave

1. **Watch for paused-schedule emails.** Each one names the schedule that stopped. Assign an owner and save it, or delete it if it's no longer needed. Schedules in their private projects email only them, so admins won't hear about those; use the list you made before they left.
2. **Check the audit log (Enterprise).** The [audit log](/docs/audit-log) records their removal.
3. **Check in with the database admins.** If integrations used credentials the person knew, rotate them. Before rotating, the [Deepnote API](/docs/api-reference) integration usage endpoints list the projects, notebooks and blocks that use each integration, except other members' private projects, so they won't show the person's own private work.

## Make the next departure easier

- **Share production projects with a group, not a person** (Enterprise), so access doesn't depend on one account.
- **Use service credentials for scheduled work.** A per-user OAuth integration gives each person their own data access, which is ideal for analysis and apps, but a schedule uses its owner's OAuth tokens, which end when they leave. For production schedules, connect an integration with service credentials limited to what the schedule needs.
- **Keep production notebooks out of private projects**, so admins can see and hand them over.
- **Name API keys after the system that uses them**, so the key list shows what breaks if a key is deleted.
- **Use directory sync (Enterprise)**, so removing someone from your identity provider removes them from Deepnote and pauses their schedules at the next sync. See [SSO and directory sync](/docs/sso).

## Plan requirements

- **Scheduling:** Pro, Team and Enterprise. Hourly and cron schedules need Team or Enterprise, but not during a Team trial, and schedules more frequent than hourly need Enterprise.
- **API keys:** Team and Enterprise.
- **User groups, directory sync, the audit log and per-user OAuth integrations:** Enterprise.

## Related

- [Least-privilege data access](/docs/playbook-least-privilege-data-access)
- [Rolling Deepnote out across an organization](/docs/playbook-rolling-out-deepnote)
- [Scheduling](/docs/scheduling)
