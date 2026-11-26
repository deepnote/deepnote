---
title: "Playbook: agents that run your notebooks on a schedule"
description: Have Claude Code, Claude in Slack or Codex run a Deepnote notebook on a schedule, read the results and tell your team what changed, with ready-made prompts to copy
noIndex: false
noContent: false
---

[Scheduling](/docs/scheduling) refreshes a notebook on its own. Sometimes you also want someone to read the results: compare them with last week, explain a failure, or post three lines to the team channel. An AI agent connected to the [Deepnote MCP server](/docs/deepnote-mcp) can do that reading on a schedule of its own. This playbook shows how to set one up and gives prompts you can copy.

## Choose Deepnote scheduling or an agent

The two work well together. Deepnote runs the notebook the same way every time; the agent decides what is worth saying about the results.

| You want to                                                              | Use                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Refresh outputs, an app or embedded charts at a fixed time               | [Deepnote scheduling](/docs/scheduling) or [`deepnote schedule`](/docs/deepnote-cli) |
| Notify a Slack channel or email when a run succeeds or fails             | Schedule notifications in Deepnote                                                   |
| Run a notebook that writes data or calls other systems                   | Deepnote scheduling                                                                  |
| Explain what changed since the last run, in words                        | An agent                                                                             |
| Diagnose a failed run and suggest the fix                                | An agent                                                                             |
| Combine a notebook's results with another tool, such as tickets or a doc | An agent with that tool connected                                                    |
| Run the same notebook for several input values and compare the results   | An agent, or one schedule per value                                                  |

A scheduled agent run counts against the agent's own usage, and each notebook run it starts uses a Deepnote machine like any other run. If a plain schedule with a notification answers the question, use that. An [agent block](/docs/deepnote-agent) inside the notebook can also write a summary on every scheduled run, without an outside agent.

## What you'll combine

| Feature                                                      | Role in this playbook                                   |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| [Deepnote MCP](/docs/deepnote-mcp)                           | Lets the agent find, run and read notebooks             |
| [Deepnote plugin](https://github.com/deepnote/agent-plugins) | Teaches the agent how to run notebooks and read results |
| [Scheduling](/docs/scheduling)                               | Runs notebooks that should run the same way every time  |
| [Input blocks](/docs/input-blocks)                           | Let the agent run one notebook for different values     |
| [Run snapshots](/docs/run-snapshots)                         | The results the agent reads                             |
| A scheduled agent task                                       | Claude Code, Claude in Slack or Codex                   |

## 1. Prepare the notebook

- **Make it safe to run unattended.** The agent runs the whole notebook, as a detached run on a machine of its own. Notebooks that only read and compute are the best fit. If a notebook writes to a database, sends messages or calls a production system, the Deepnote plugin tells the agent to ask before running it, and an unattended run has nobody to ask. Schedule that notebook in Deepnote and have the agent read the results instead (recipe 2).
- **Put the answer in outputs.** The agent reads the run's outputs: tables, printed values, big numbers and chart data. A final block that prints the headline numbers makes the summary reliable.
- **Turn parameters into inputs.** A date, region or segment [input](/docs/input-blocks) lets the agent run the notebook for any value. Values the agent passes apply to that run only and don't change the notebook's saved defaults.
- **Copy the notebook's link.** Prompts below refer to the notebook by its URL, so the agent doesn't have to guess between notebooks with similar names.

## 2. Give the agent access to Deepnote

A workspace admin needs to turn on **MCP access** for the workspace. The agent can see and run only what its Deepnote account or API key can. If **Enforce OAuth** is on, API keys are rejected and the agent has to sign in with OAuth (see [Least-privilege data access](/docs/playbook-least-privilege-data-access)).

How the agent connects depends on where it runs. Each host has its own scheduling feature, plan requirements and limits, so check its documentation too.

### Claude Code scheduled tasks

[Scheduled tasks](https://code.claude.com/docs/en/routines) (formerly routines) run in Anthropic's cloud on a schedule, so they keep working when your laptop is closed. Create one at [claude.ai/code/routines](https://claude.ai/code/routines) or with `/schedule` in Claude Code.

- **Connect Deepnote as a connector.** A scheduled task uses the connectors on your claude.ai account, not MCP servers or plugins you installed in the CLI. At [claude.ai/customize/connectors](https://claude.ai/customize/connectors), add a custom connector named `Deepnote` with the URL `https://deepnote.com/mcp` and sign in. Connect Slack too if the task should post there.
- **The task acts as you.** It runs with your Deepnote access, and anything it posts through a connector appears under your name.
- **Trim connectors.** New tasks include all your connectors. Remove the ones the task doesn't need.
- **Times.** Preset frequencies use your local time. A custom cron expression is in UTC unless it starts with `CRON_TZ=`, and tasks can't run more often than once an hour.

### Claude in Slack (Claude Tag)

[Claude Tag](https://claude.com/docs/claude-tag/overview) runs [routines](https://claude.com/docs/claude-tag/users/proactivity) set up in a channel. A routine uses the channel's connections, never a member's personal connectors, so an admin has to give Claude access to Deepnote first:

1. Create a dedicated Deepnote account for Claude with access to only the projects its channels should reach. Everyone in a channel where the connection applies can use it through Claude, so give it the least access that works.
2. In [**Organization settings > Claude Tag**](https://claude.ai/admin-settings/claude-tag), add the Deepnote plugin from [deepnote/agent-plugins](https://github.com/deepnote/agent-plugins) to your organization's plugins and attach it where Claude should use Deepnote. Claude Tag syncs only private repositories, so upload the plugin or sync a private fork.
3. Add a [custom connector](https://claude.com/docs/claude-tag/admins/connections/custom) with **Allowed websites** set to `deepnote.com`: either **Bearer** with an API key created by the dedicated account, or **MCP Connector** signed in as that account, which needs Deepnote added as a connector for your organization on claude.ai first. The MCP server takes `POST` requests, so don't limit the credential to read-only methods; limit what the account can access in Deepnote instead.

Then set the routine up in the channel by mentioning `@Claude` with the schedule and the work in one message. Name the time zone: routines run in UTC and can't run more often than once an hour. Anyone in the channel can list routines with `@Claude !scheduled` and pause or stop them.

### Codex scheduled tasks

[Codex scheduled tasks](https://developers.openai.com/codex/app/automations) can use plugins and skills. Install the [Deepnote plugin for Codex](/docs/deepnote-mcp#deepnote-plugin-for-claude-code-and-codex) and sign in, then ask Codex in a chat to schedule the prompt. To make sure each run uses Deepnote, name the plugin's `deepnote-runs` skill in the prompt; the desktop app invokes a skill with `$` followed by its name. Runs and their findings appear under **Scheduled** in the desktop app's sidebar. A task that works in a local project needs the computer on and the app running.

## 3. Write the prompt

A scheduled run has no one to answer questions, so the prompt has to stand on its own:

- **Name the notebook by its link**, and any input values to pass.
- **Say what to compare against**, such as the previous successful run.
- **Fix the output format**, such as three bullets and a link, so recurring posts stay easy to scan.
- **Say when to stay quiet**, for example when nothing moved more than a threshold.
- **Say what to do when the run fails:** report the first error and stop, rather than retrying or editing the notebook.

Try the prompt by hand once before scheduling it, and read the first few scheduled results.

## Recipes

Replace the links, names and times with your own. The prompts work in any of the hosts above; in Claude Tag, start them with `@Claude` and the schedule, as recipe 1 does. Where a recipe suits one host best, it says so.

### 1. Weekly metrics summary in Slack

Runs the notebook every Monday and posts what changed since last week. Suits a Claude Tag routine in the team's channel.

```text
@Claude every Monday at 8am Eastern, run the Deepnote notebook https://deepnote.com/workspace/acme/project/Weekly-KPIs-1234/notebook/Overview-5678 and wait for it to finish. Compare its outputs with the previous successful run of the same notebook. Post three bullets on the biggest changes, each with the number and the change since last week, then a link to the notebook. If the run fails, post the first error instead and don't rerun it.
```

**Deepnote access:** the dedicated account needs to be able to run the notebook.

### 2. Read a report Deepnote already scheduled

Deepnote runs the notebook on its own [schedule](/docs/scheduling), and the agent only reads the result. Use this for notebooks that write data, or when the run must happen at an exact time. Schedule the agent a little after the notebook usually finishes.

```text
Find the most recent run of the Deepnote notebook https://deepnote.com/workspace/acme/project/Revenue-1234/notebook/Daily-close-5678. If it finished successfully today, read its outputs and write a short summary for the finance team: total revenue, the three largest movements by region and anything that looks unusual. If it failed, explain the first actionable error and the likely cause. If it hasn't run today, say so. Don't start a new run.
```

**Deepnote access:** the account needs to be able to view the notebook. It never starts a run, so it can't change data.

### 3. Morning check of every scheduled notebook

Looks for scheduled notebooks whose latest run failed, so someone fixes them before readers notice. Suits a Claude Code scheduled task on weekdays.

```text
List the projects in my Deepnote workspace and find every notebook that is scheduled. For each one, check its most recent run. For every notebook whose latest run failed, report the notebook name, a link to it, when it failed, the first actionable error and the most likely fix. Don't rerun or edit anything. If every scheduled notebook's latest run succeeded, reply with one line saying so.
```

**Deepnote access:** view access to the projects to check. In a large workspace, name the projects or folder to check instead of the whole workspace.

### 4. One notebook, every region

Runs the same notebook once per input value and compares the results side by side. The notebook needs a `region` [input](/docs/input-blocks), or change the name to match yours.

```text
Run the Deepnote notebook https://deepnote.com/workspace/acme/project/Pipeline-1234/notebook/Forecast-5678 three times, with the input region set to EMEA, North America and APAC. Wait for all three runs to finish. Put the forecast and its change since last month for each region in one table, then name the region that needs attention and why. If a run fails, report its first error and continue with the others.
```

**Deepnote access:** the account needs to be able to run the notebook. If your workspace's limit on runs in parallel rejects a run, the agent reports it.

## Plan requirements

- **Deepnote MCP:** a workspace admin turns on MCP access.
- **Deepnote scheduling:** Pro, Team and Enterprise. See [Scheduling](/docs/scheduling) for hourly and custom schedules.
- **Claude Code scheduled tasks:** Pro, Max, Ultra, Team and Enterprise plans on claude.ai, while the feature is in research preview.
- **Claude Tag:** Claude Team and Enterprise, in public beta.
- **Codex scheduled tasks:** see [OpenAI's documentation](https://developers.openai.com/codex/app/automations).

## Related

- [Reports that deliver themselves](/docs/playbook-reports-that-deliver-themselves): a recurring report built entirely in Deepnote
- [Business alerts](/docs/playbook-business-alerts): notify people when a metric crosses a line
- [Deepnote MCP](/docs/deepnote-mcp): connect an agent and see every tool it can use
