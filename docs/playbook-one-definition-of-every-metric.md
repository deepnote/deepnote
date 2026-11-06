---
title: "Playbook: one definition of every metric"
description: Build a semantic layer from Deepnote modules so that notebooks, apps, schedules and AI all calculate each metric the same way, and changes to a definition are controlled
noIndex: false
noContent: false
---

When every analyst writes their own revenue query, the company ends up with several revenue numbers. A semantic layer reduces this by defining each metric once and having everything else use that definition. Numbers can still differ when someone writes their own query instead of importing the module, or filters it differently. The module library's list of importing projects shows who uses each definition.

In Deepnote you can build that layer from [modules](/docs/modules), notebooks that other notebooks import. This playbook shows how to structure metric modules so that ad-hoc analyses, apps, scheduled reports and Deepnote's AI all use them, and how to control who can change a definition.

## What you'll combine

| Feature                                                         | Role in this playbook                               |
| --------------------------------------------------------------- | --------------------------------------------------- |
| [Modules](/docs/modules)                                        | Each metric's single definition                     |
| [Input blocks](/docs/input-blocks)                              | Parameters such as date range, region or plan       |
| [Team permissions](/docs/team-permissions) and groups           | Who can change a definition and who can only use it |
| [Notebook locking](/docs/notebook-locking)                      | Guards against accidental edits                     |
| [Version history](/docs/history) and [comments](/docs/comments) | Records why a definition changed                    |
| [Scheduling](/docs/scheduling) and [apps](/docs/data-apps)      | Consume the definitions in reports and dashboards   |
| [Deepnote Agent](/docs/deepnote-agent)                          | Uses the definitions when answering questions       |

## How modules behave

These module behaviors affect the setup:

- **A module runs in its own project.** When a notebook runs a module block, the module executes on its own project's machine, with that project's environment and integrations, and returns only the values it exports. People using the metric don't need the database integration in their own project. Exported functions are the exception: an imported function runs in the importing notebook, so anything it uses, such as an integration, must be available there or passed in.
- **The caller needs Execute access.** A module runs as the person, or the schedule owner, who triggered it. They need at least Execute access to the module's project.
- **Changes apply on the next run.** Every notebook that imports a module picks up its latest version the next time the module block runs. If a change affects configuration, for example a new input, the module block flags it before running.
- **Input blocks become parameters.** Each input block in the module becomes a parameter that the importing notebook can set or bind to one of its own variables.
- **Modules can read the SQL cache.** Module runs can use cached query results when [SQL query caching](/docs/sql-query-caching) is enabled, so a popular metric doesn't query the warehouse each time. Caching is off for integrations that use OAuth, so metrics built on Snowflake OAuth or BigQuery with Google OAuth query the warehouse on every run.
- **Private-project modules stay private.** A module in a private project can only be used from other private projects.

## Set it up

### 1. Create a metrics project

Create one project, for example "Metrics", shared with the whole workspace. Every metric gets its own notebook in this project. Keeping them together means one set of integrations, one environment, and one place to manage who can change definitions.

### 2. Write each metric as a notebook

For each metric:

1. Start with a text block that defines the metric in plain language: what it counts, what it excludes, and who owns it. People reading the notebook, and Deepnote's AI, both use this description.
2. Add input blocks for the parameters people change, such as `start_date`, `end_date` or `region`. Give them sensible defaults, so that running the module with no overrides returns the standard number.
3. Write the calculation in SQL or Python blocks.
4. [Export](/docs/modules#creating-a-module) the result: one DataFrame at the grain people need, such as daily revenue by region, and the headline value if useful. Name the exports clearly, for example `revenue_daily` and `revenue_total`.
5. Publish the notebook as a module.

### 3. Control who can change a definition

Workspace access is one of the grants that decide a person's access to a project: they get the access the project grants the workspace, capped by what their workspace role allows. Direct sharing and link sharing can give them more, and a person gets the most permissive of their grants, so check those too. Workspace admins always have full access to projects shared with the workspace. To make the definitions read-only for most people:

1. In the metrics project's sharing settings, set workspace access to **Execute**. Workspace members can now run and import the modules but can't edit them, even if their role is Editor.
2. Share the project with the metric owners, for example the analytics engineering group, at **Edit**.
3. Lock each metric notebook so that owners don't change it by accident while browsing. A lock guards against mistakes in the editor; anyone with Edit access can unlock a notebook for themselves.
4. Discuss proposed changes in [comments](/docs/comments) on the affected block before making them.

Sharing with [user groups](/docs/team-permissions#user-groups) keeps step 2 manageable and is available on the Enterprise plan.

### 4. Use the definitions everywhere

- **Ad-hoc analysis:** import the module and set its inputs. The imported variables appear in your notebook like any other.
- **Apps:** build the dashboard on module imports, so it shows the same numbers as everyone else.
- **Scheduled reports:** a scheduled notebook that imports a module runs it as the schedule's owner on every run, so the report always uses the current definition.
- **Deepnote Agent:** Agent sees a limited number of the modules you can access, those whose notebooks were created most recently first, and in Edit mode, can insert a module block with the right inputs. See [Trustworthy AI answers on your data](/docs/playbook-trustworthy-ai-answers).

### 5. Check the impact before changing a definition

The module library, under **Modules** in the workspace sidebar, shows each module's source project and the projects that import it. Before changing a definition, check that list and tell the owners of those projects. Version history saves a version automatically every 10 minutes while someone works, so an edit that is made and undone between two versions may not appear. Create a named version before and after changing a definition to keep a clear record, for as long as your plan keeps history.

## Governance

With the setup above:

| Who                                  | Access to the metrics project                         | What they can do                           |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------ |
| Metric owners                        | Edit, shared directly                                 | Change definitions and publish modules     |
| Workspace admins                     | Full access                                           | Everything, including deleting the project |
| Editors and Viewers in the workspace | Execute, from the project's workspace access          | Run and import modules                     |
| Restricted users and guests          | None, unless the project is shared with them directly | Nothing                                    |

Version history is kept for 7 days on Free, 30 days on Team and without limit on Enterprise.

## Plan requirements

- **Modules:** all plans.
- **Scheduling:** Team and Enterprise.
- **SQL query caching:** Team and Enterprise.
- **Sharing a project at Execute level with individual people:** Team and Enterprise.
- **User groups and unlimited version history:** Enterprise.

## Variations

- **Finance:** one module per reported figure, with a `fiscal_period` input that follows the company's fiscal calendar. Month-end packs import them, so the board pack matches the dashboards.
- **SaaS metrics:** `mrr`, `net_revenue_retention` and `active_accounts` as modules with a `segment` input, imported by the customer success dashboard and the board deck alike.
- **Shared data cleaning:** a module that returns a cleaned, de-duplicated customers table. Every analysis starts from the same rows.
