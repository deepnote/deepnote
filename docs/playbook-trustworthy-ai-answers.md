---
title: "Playbook: trustworthy AI answers on your data"
description: Make Deepnote Agent, the Slack agent and external coding agents give consistent, governed answers by setting up modules, canonical queries, MCP integrations and permissions once
noIndex: false
noContent: false
---

An AI assistant answering questions about your business is only as reliable as the context it works from. Asked "what was revenue last quarter?", an agent with no context invents a definition of revenue and picks whichever table looks right. Two people asking the same question get two different numbers.

Deepnote gives its AI the same context your analysts use: the metric definitions your team has published, the queries it already trusts, your connected tools and your permissions. This playbook shows how to set that context up once so that every AI surface, in a notebook, in Slack, and in Claude, Codex or Cursor, starts from the same definitions.

## What you'll combine

| Feature                                                    | Role in this playbook                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Modules](/docs/modules)                                   | Published metric definitions the agent can find and import                     |
| [Scheduling](/docs/scheduling) and [apps](/docs/data-apps) | Mark the queries the AI should learn from                                      |
| [Deepnote Agent](/docs/deepnote-agent)                     | Builds analyses in notebooks                                                   |
| MCP integrations                                           | Connect the agent to tools that already define your metrics, such as dbt       |
| [Slack agent](/docs/slack)                                 | Runs existing notebooks from Slack and summarizes the results                  |
| [Deepnote MCP server](/docs/deepnote-mcp)                  | Gives Claude, Codex and Cursor the same workspace                              |
| [Custom AI instructions](/docs/custom-ai-instructions)     | Personal preferences for each analyst                                          |
| [Team permissions](/docs/team-permissions)                 | Decide what every AI surface can see, because each acts as the person using it |

## What the agent reads

Knowing what context Deepnote's AI uses tells you where to put your effort.

- **The open notebook.** Agent reads every block in the notebook you're working in. If a workspace admin turns on **Provide access to block outputs** in **Settings & members** → **AI**, it also reads outputs, including row-level data.
- **Your modules.** Every request includes the 20 most recently created [modules](/docs/modules) you have access to, with their input parameters and exported values. Agent is told to treat modules as the workspace's semantic layer. In Edit mode, it can insert a module block and set its inputs to match your question.
- **Queries your team already runs.** When Agent writes or edits SQL for a database integration, it looks for relevant tables in that integration's schema and adds up to five example queries that already ran successfully on the same integration. It prefers queries from scheduled notebooks, then queries from published apps, then any other executed query. Only projects you can access are used.
- **Tables you mention.** Typing `@` in a prompt lets you name a table, which then always goes into the context.
- **Connected MCP integrations.** In Edit mode, Agent can call tools from MCP integrations connected to the project. Agent is told to look up metrics, schemas and catalogs in those services before writing its own queries.
- **Your custom instructions.** Each person's [custom instructions](/docs/custom-ai-instructions) are added to their own requests. They're personal and aren't shared with teammates.

## Set it up

### 1. Publish the metrics people ask about as modules

Start with the five to ten numbers people ask about most often: revenue, active users, churn. Build each one in its own notebook, add input blocks for the parameters people change, such as the date range or region, and export the final value or DataFrame. Then publish the notebook as a module. [One definition of every metric](/docs/playbook-one-definition-of-every-metric) walks through this in detail.

Two details decide whether Agent finds a module:

- Agent sees the 20 most recently created modules you can access. If your workspace has more, retire outdated ones so the important definitions stay in view.
- A module in a private project can only be used from other private projects. Put shared definitions in a project the whole workspace can access.

### 2. Schedule or publish your canonical queries

When Agent writes SQL, the queries it learns from come first from scheduled notebooks and then from published apps. Your production reporting therefore doubles as training material. Schedule the notebooks whose queries reflect how your team actually joins and filters the data, and keep exploratory or broken queries out of them.

### 3. Connect the tools that already hold definitions

If your metrics or documentation already live somewhere else, connect that service as an MCP integration instead of copying it into notebooks. Deepnote's integration list includes MCP servers for dbt, Metabase, Grafana, Snowflake, BigQuery, Linear, GitHub and many others, and you can add any MCP server reachable at a URL as a custom integration.

For example, with the dbt MCP integration connected to a project, Agent in Edit mode can look up a metric's definition in dbt before it writes SQL, instead of guessing from table names.

### 4. Decide how much data the AI may see

**Provide access to block outputs** controls whether Agent can read outputs, including row-level data. The Slack agent needs it, because it summarizes notebook outputs. On the Enterprise plan you can also route requests to [your own AI models](/docs/ai-custom-models) or to EU-hosted models. See [AI data privacy](/docs/ai-data-privacy) for what is sent to each provider.

### 5. Use the same workspace from every surface

All of these work from the same context:

- **In a notebook**, Agent can import your modules and learn from your scheduled queries.
- **In Slack**, @-mention the Deepnote app to find a notebook, run it with the input values you give, and get a summary of the results. It runs notebooks your team has already built, so the answer comes from a reviewed analysis rather than a new one. If the notebook has inputs you didn't give values for, it asks before running.
- **In Claude, Codex or Cursor**, the [Deepnote MCP server](/docs/deepnote-mcp) lets the agent search projects, notebooks, blocks and integrations, read an integration's cached table structure, and run notebooks.

## Governance

Every AI surface acts as the person using it.

- Agent reads only the projects, modules and example queries the current user can access.
- The Slack agent acts as the Deepnote account linked to the person who mentioned it, so it can find and run only what that person can.
- The MCP server uses the API key or sign-in of whoever connected it.

So you don't need separate permissions for AI. Restricting a project in Deepnote also keeps it out of AI answers for people who can't open it.

Database integrations that use per-user OAuth, such as [Snowflake OAuth](/docs/snowflake-oauth) or [BigQuery with Google OAuth](/docs/bigquery-oauth), go one step further: each person, and the AI acting for them, can query only the tables their own credentials allow.

## Plan requirements

- **Deepnote Agent:** available on Free, Team and Enterprise, with limited requests on Free.
- **Scheduling:** Team and Enterprise.
- **Custom and EU-hosted AI models:** Enterprise.
- **Per-user OAuth for database integrations:** Enterprise.

## Variations

- **Finance:** publish revenue, bookings and ARR as modules with a fiscal-period input. Finance analysts and the agent then use the same fiscal calendar.
- **Product analytics:** connect the dbt MCP integration so Agent reads metric definitions from dbt, and schedule the weekly product review notebook so its queries become the agent's examples.
- **Support and operations:** in Slack, ask the agent to run the queue-health notebook for a particular team and summarize it, without opening Deepnote.
