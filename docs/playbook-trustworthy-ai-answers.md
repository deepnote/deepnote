---
title: "Playbook: trustworthy AI answers on your data"
description: Make Deepnote Agent, the Slack agent and external coding agents start from the same definitions, queries and permissions by setting up modules, canonical queries, MCP integrations and permissions once
noIndex: false
noContent: false
---

An AI assistant answering questions about your business is only as reliable as the context it works from. Asked "what was revenue last quarter?", an agent with no context invents a definition of revenue and picks whichever table looks right. Two people asking the same question get two different numbers.

Deepnote gives its AI the same context your analysts use: the metric definitions your team has published, the queries it already trusts, your connected tools and your permissions. This playbook shows how to set that context up once so that every AI surface, in a notebook, in Slack, and in Claude, Codex or Cursor, can start from the same definitions. Connecting a surface makes those definitions available, but doesn't make it use them: name the notebook or module in your prompt, and in Slack ask for the notebook that holds the answer. Good context makes answers more consistent and easier to check, but not necessarily correct. Review the SQL Agent writes before you rely on it, and prefer answers that come from running a notebook your team has reviewed.

## What you'll combine

| Feature                                                | Role in this playbook                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [Modules](/docs/modules)                               | Published metric definitions the agent can find and import                                         |
| [Scheduling](/docs/scheduling)                         | Marks the queries the AI should learn from                                                         |
| [Deepnote Agent](/docs/deepnote-agent)                 | Builds analyses in notebooks                                                                       |
| MCP integrations                                       | Connect the agent to tools that already define your metrics, such as dbt                           |
| [Slack agent](/docs/slack)                             | Runs existing notebooks from Slack and summarizes the results                                      |
| [Deepnote MCP server](/docs/deepnote-mcp)              | Gives Claude, Codex and Cursor the same workspace                                                  |
| [Custom AI instructions](/docs/custom-ai-instructions) | Personal preferences for each analyst                                                              |
| [Team permissions](/docs/team-permissions)             | Decide what every AI surface can see, because each acts as the person whose account or key it uses |

## What the agent reads

Knowing what context Deepnote's AI uses tells you where to put your effort.

- **The open notebook.** Agent reads the blocks of the notebook you're working in, including their text outputs and previews of variables in memory, which can contain row-level data.
- **Your modules.** Every request includes a limited number of the [modules](/docs/modules) you have access to, newest notebooks first, with their input parameters and exported values. Agent is told that modules can serve as a semantic layer, but not to prefer them, so name or `@`-mention the module in your prompt. In Edit mode, it can insert a module block and set its inputs to match your question.
- **Queries your team already runs.** When Agent writes SQL for a database integration, it looks for relevant tables in that integration's schema and adds up to five example queries that have already been run on the same integration. It takes queries from scheduled notebooks first, then any other executed query. Only projects you can access are used.
- **Resources you mention.** Typing `@` in a prompt lets you mention a project, integration or module, so Agent knows exactly which one you mean.
- **Connected MCP integrations.** In Edit mode, Agent can call tools from MCP integrations connected to the project. Agent is told to look up metrics, schemas and catalogs in those services before writing its own queries.
- **Your custom instructions.** Each person's [custom instructions](/docs/custom-ai-instructions) are added to their own requests. They're personal and aren't shared with teammates.

## Set it up

### 1. Publish the metrics people ask about as modules

Start with the five to ten numbers people ask about most often: revenue, active users, churn. Build each one in its own notebook, add input blocks for the parameters people change, such as the date range or region, and export the final value or DataFrame. Then publish the notebook as a module. [One definition of every metric](/docs/playbook-one-definition-of-every-metric) walks through this in detail.

Two details decide whether Agent finds a module:

- Agent sees the 20 modules you can access whose notebooks were created most recently. Publishing an older notebook as a module doesn't move it up, so retire outdated modules to keep the important definitions in view. Agent can still use others if you `@`-mention them or it finds them by searching the workspace.
- A module in a private project can only be run by that project's owner. Put shared definitions in a project the whole workspace can access.

### 2. Schedule your canonical queries

When Agent writes SQL, the queries it learns from come first from scheduled notebooks. Your scheduled reports become the examples the AI follows. Schedule the notebooks whose queries reflect how your team joins and filters the data, and keep exploratory or broken queries out of them.

### 3. Connect the tools that already hold definitions

If your metrics or documentation already live somewhere else, connect that service as an MCP integration instead of copying it into notebooks. Deepnote's integration list includes MCP servers for dbt, Metabase, Grafana, Snowflake, BigQuery, Linear, GitHub and many others, and you can add any MCP server reachable at a URL as a custom integration.

For example, with the dbt MCP integration connected to a project, Agent in Edit mode can look up a metric's definition in dbt before it writes SQL, instead of guessing from table names.

### 4. Decide how much data the AI may see

**Provide access to block outputs** in **Settings & members** → **AI** controls whether AI inside a single code or SQL block can read outputs. The Slack agent needs it, because it summarizes notebook outputs. Deepnote Agent in the side panel reads outputs either way. On the Enterprise plan you can also route Agent requests to [your own AI models](/docs/ai-custom-models) or to EU-hosted models. Code completions still use Deepnote's completions provider, and finding tables for SQL still sends your prompt and table names to OpenAI. Turn completions off in the workspace settings if that matters to you. See [AI data privacy](/docs/ai-data-privacy) for what is sent to each provider.

### 5. Use the same workspace from every surface

All of these work from the same context:

- **In a notebook**, Agent can import your modules and learn from your scheduled queries.
- **In Slack**, @-mention the Deepnote app to find a notebook, run it with the input values you give, and get a summary of the results. It runs notebooks your team has already built, so the answer comes from a reviewed analysis rather than a new one. If the notebook has inputs you didn't give values for, it asks before running. It can't run projects that run privately.
- **In Claude, Codex or Cursor**, the [Deepnote MCP server](/docs/deepnote-mcp) lets the agent search projects, notebooks, blocks and integrations, read an integration's cached table structure, and run notebooks.

## Governance

Every AI surface acts as a person: the one using it, or for the MCP server, the one whose sign-in or key it was connected with.

- Agent reads only the projects, modules and example queries the current user can access.
- The Slack agent acts as the Deepnote account linked to the person who mentioned it, so it can find and run only what that person can.
- The MCP server uses the API key or sign-in it was connected with, which acts as the person who created that key or signed in. Have each person connect their own client with their own sign-in or key; a shared key gives everyone using it the key creator's access.

So you don't need separate permissions for AI. Restricting a project in Deepnote also keeps it out of AI answers for people who can't open it, as long as nobody shares an API key; turn on **Enforce OAuth** in the AI settings to make every MCP client sign in as its own user.

Database integrations that use per-user OAuth, such as [Snowflake OAuth](/docs/snowflake-oauth) or [BigQuery with Google OAuth](/docs/bigquery-oauth), go one step further: each person, and the AI acting for them, can query only the tables their own credentials allow.

## Example

In the [Revenue review app](https://github.com/deepnote/deepnote/tree/main/examples/lindquett-software/revenue-review) of the Lindquett Software example, an agent block writes
the analyst note at the top of the dashboard. Its prompt tells it to use the functions from the
`Revenue metrics` module instead of writing its own definitions, and a guide block lists the tables and
functions it can use, so the note uses the same metric definitions as the charts below it.

## Plan requirements

- **Deepnote Agent:** available on all plans, with a request limit on Free and monthly AI credits on paid plans.
- **Slack agent and the Deepnote MCP server:** Team and Enterprise.
- **Scheduling:** Pro, Team and Enterprise.
- **Custom and EU-hosted AI models:** Enterprise.
- **Per-user OAuth for database integrations:** Enterprise.

## Variations

- **Finance:** publish revenue, bookings and ARR as modules with a fiscal-period input. Finance analysts and the agent then use the same fiscal calendar.
- **Product analytics:** connect the dbt MCP integration so Agent reads metric definitions from dbt, and schedule the weekly product review notebook so its queries become the agent's examples.
- **Support and operations:** in Slack, ask the agent to run the queue-health notebook for a particular team and summarize it, without opening Deepnote.
