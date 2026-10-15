---
title: Deepnote MCP
description: Connect AI agents to your Deepnote workspace via the Model Context Protocol.
noIndex: false
noContent: false
---

## What is Deepnote MCP?

The **Deepnote MCP server** exposes your Deepnote workspace to AI agents through the Model Context Protocol (MCP), an open standard for connecting LLMs to external tools and data.

Once connected, agentic harnesses and IDEs such as Codex, Claude, Cursor, VS Code, or any MCP-compatible client can explore your projects, read, create, edit, run, and delete notebooks, manage project files and machines, publish apps, inspect your data integrations, and search Deepnote's documentation within your existing permissions.

This means you can ask your assistant to "create a notebook in my analytics project and add a SQL block that queries last month's revenue", and it will use the Deepnote MCP tools to carry out each step.

The MCP server uses the same workspace API keys as the [Deepnote API](/docs/deepnote-api).

## Deepnote MCP Endpoint

The Deepnote MCP speaks the standard MCP protocol over HTTP `POST`, so any compliant client can connect.

```text
https://deepnote.com/mcp
```

## Authentication

Every request to the MCP server must be authenticated. There are two supported methods.

### API key

Create an API key in your workspace under **Settings & members > Security > API keys**, then configure your MCP client to send it as a bearer token:

```
Authorization: Bearer YOUR_API_KEY
```

### OAuth 2.0

Clients that support remote MCP servers with OAuth (for example Claude and Cursor) can connect without manually copying a key. Please point the client at `https://deepnote.com/mcp` and it will discover the authorization server automatically and walk you through an in-browser sign-in.

## Available tools

The server exposes the following tools. Read-only tools never modify your workspace; write tools require an API key or account with edit access.

### Account and workspace

- `get_me`: Return info about the API key or account calling the server: the key name and type, who created it, the workspace, and the access level (viewer, editor, admin, etc.).
- `search`: Search workspace resources across projects, notebooks, blocks, and integrations.
- `list_projects`: List workspace projects, optionally filtered by name.
- `list_folders`: List workspace folders and how they nest, so an agent can turn a folder name or path into the folder ID that `create_project` accepts.
- `get_project`: Get a project's metadata, notebooks, attached integrations, files, static website settings, and environment.
- `create_project`: Create a new project, optionally inside a folder and on a chosen environment.
- `update_project`: Change a project's environment, its static website sharing and viewer API access, and whether its Streamlit apps may call the Deepnote API as their viewers. Changing the environment restarts a running machine.
- `delete_project`: Move a project and all its notebooks to the workspace trash.

### Notebooks and blocks

- `get_notebook`: Get notebook details, including its blocks and input variables.
- `create_notebook`: Create an empty notebook inside a project.
- `update_notebook`: Rename a notebook. Naming it `Init` turns it into the project's [init notebook](/docs/project-initialization).
- `duplicate_notebook`: Duplicate an existing notebook within a project.
- `delete_notebook`: Delete a notebook. A project version is saved first, so you can restore it from version history.
- `get_block`: Get a block's content and metadata, and optionally the outputs it shows in the editor.
- `create_block`: Create a new block (SQL, Python, text, input, etc.) in a notebook.
- `update_block`: Update the contents of an existing block.
- `delete_block`: Delete a block from a notebook.
- `reorder_notebook_blocks`: Move one or more blocks to a new position within a notebook.
- `generate_project_url`: Generate a link to a Deepnote project or notebook, so an agent can hand you a URL to what it built.

### Files

- `write_file`: Write text or base64 content to a file in a project, with the path relative to the project root. With `overwrite` set it replaces an existing file; otherwise Deepnote picks a unique path and returns it.
- `copy_file`: Copy a file into another project at the same path.
- `delete_file`: Permanently delete a file from a project. A Streamlit app that uses the file as its entry point is deleted with it.

### Running notebooks

- `create_run`: Start running a notebook and return the created run. Runs are detached by default and can use a different machine type than the project's; set `detached` to false for live mode or to run specific blocks.
- `get_run`: Get a notebook run. Returns a presigned snapshot download URL when available, or optionally the inline snapshot content or the executed blocks with their outputs. Large outputs are shortened unless `fullOutputs` is set.
- `list_notebook_runs`: List historical runs for a notebook.

### Machines and environments

- `get_machine`: Check whether a project's machine is stopped, starting, running, stopping, or in an error state, along with its machine type and sandbox environment.
- `start_machine`: Start a project's machine. It uses machine time until it stops.
- `stop_machine`: Stop a project's machine. Project files are kept, but kernel state such as variables is lost for everyone in the project.
- `restart_machine`: Replace a project's machine with a new one, which also recovers a machine in an error state. Kernel state is lost.
- `update_machine`: Change a project's machine type, sandbox environment, or how long it keeps running without activity. Changing the type or sandbox environment of a running machine needs a restart.
- `list_machine_types`: List the machine types the workspace can use, with their vCPUs, memory, and GPUs, and whether the plan and this month's free quota allow each one.
- `list_environments`: List the environments (Docker images) projects can run on, including the workspace's custom images.

These tools manage the machine behind the editor, live-mode runs, and hosted Streamlit apps. Detached runs start machines of their own, so an agent doesn't need to start the project's machine before calling `create_run`.

### Apps and static sites

- `create_streamlit_app`: Serve a project file as a [Streamlit app](/docs/streamlit) and return its URL.
- `list_streamlit_apps`: List a project's Streamlit apps with the file each one runs and its URL.
- `get_streamlit_app_status`: Check whether a Streamlit app is running, starting, or unavailable.
- `publish_static_site`: Publish a small HTML, CSS, and JavaScript site from the project's `_deepnote_static/` folder and share it as an app. For larger sites, use [`deepnote publish`](/docs/deepnote-cli-publish) from the CLI.

<Callout status="warning">
Creating a Streamlit app with `create_streamlit_app` restarts the project machine and interrupts anyone working in the project.
</Callout>

### Integrations

- `list_integrations`: List workspace integrations, optionally filtered by name or type.
- `get_integration`: Get integration details and its cached table structure.
- `list_integration_project_usages`: List projects connected to an integration.
- `list_integration_notebook_usages`: List notebooks that contain SQL blocks using an integration.
- `list_integration_block_usages`: List SQL blocks that use an integration.
- `create_integration`: Create a new workspace integration.
- `attach_integration`: Attach an existing integration to a project.
- `detach_integration`: Detach an integration from a project.

### Documentation

- `list_docs`: Return the Deepnote docs navigation tree so the assistant can find the right article.
- `get_doc`: Fetch the full Markdown body of a documentation article by slug.

### What deleting does

Deleting a project, a notebook, or a file works differently once it has run, so it helps to know which ones can be undone.

Deleting a notebook with `delete_notebook` saves a project version first. You can bring the notebook back from [version history](/docs/history).

Deleting a project with `delete_project` moves it to the [trash](/docs/trash), where you can restore it for 30 days. Its schedules are removed and don't come back with a restore, and its machine is stopped.

<Callout status="warning">
Deleting a file with `delete_file` can't be undone in Deepnote, since project files aren't versioned. The same applies to the old content when `write_file` overwrites a file.
</Callout>

## Connecting a client

The examples below assume you have created a workspace API key under **Settings & members > Security > API keys**.

### Connecting Claude Code / Claude Cowork to Deepnote via UI

**Add it as a custom connector in the UI**

1. Open **Settings → Connectors.**
2. Click **Add custom connector**.
3. Name: `Deepnote`, URL: `https://deepnote.com/mcp`.
4. Save, then complete the **OAuth sign-in** when prompted.
5. It will then appear in `/mcp`.

### Connecting to Codex

Codex provides a data analytics plugin that packages connectors for data tools like Deepnote along with workflows that allow users to more easily diagnose metric movements, answer product and business questions, and create documents and reports.

Thanks to the Deepnote connector, teams can bring trusted business context from the tools they already use into data analytics workflows in Codex.

To connect Deepnote to Codex, the easiest way is to request a connection via ‘connect to deepnote mcp via [https://deepnote.com/mcp](https://deepnote.com/mcp)’. Codex will surface a UI for you to paste your Deepnote MCP token.

![Codex displaying a secure prompt to paste a Deepnote MCP token](../assets/docs/deepnote-mcp/codex-deepnote-mcp-token-prompt.webp)

_Figure 1. Paste your Deepnote MCP token into the secure prompt surfaced by Codex._

### Claude Desktop / Cursor (JSON config)

If your client uses JSON MCP configuration, add Deepnote as a remote server:

```json
{
  "mcpServers": {
    "deepnote": {
      "url": "https://deepnote.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Save the configuration and restart the client. The Deepnote tools should appear in the MCP tool list.

### Connecting Deepnote in ChatGPT UI

While Codex is the recommended OpenAI route when you want the [corresponding plugin for a data-analysis workflow](https://github.com/openai/plugins/tree/main/plugins/deepnote), [Deepnote can also be connected directly in the ChatGPT web app.](https://chatgpt.com/apps/deepnote/asdk_app_69fb51f9519081919c1f3e44ea9a5a05)

1. Open the Deepnote app in ChatGPT.
2. Select **Sign in with Deepnote**.

![ChatGPT displaying the Deepnote app permission dialog with a Sign in with Deepnote button](../assets/docs/deepnote-mcp/chatgpt-deepnote-app-permission-dialog.webp)

_Figure 2. Review the Deepnote app permission dialog, then select **Sign in with Deepnote**._

3. Choose the Deepnote workspace ChatGPT may access.

4. Select **Authorize**.

![Deepnote authorization dialog for choosing a workspace and authorizing ChatGPT access](../assets/docs/deepnote-mcp/deepnote-workspace-authorization-dialog.webp)

_Figure 3. Choose the Deepnote workspace ChatGPT may access, then select **Authorize**._

5. Start with a prompt that confirms workspace access.

![ChatGPT prompt composer with Deepnote enabled and a starter workspace-summary request](../assets/docs/deepnote-mcp/chatgpt-deepnote-workspace-summary-prompt.webp)

_Figure 4. Send a starter prompt such as “Can you summarize my Deepnote workspace?” to confirm that the connection is working._

## Verify the connection

Call the MCP server directly with curl to list the tools exposed to your authenticated identity:

```bash
curl -s https://deepnote.com/mcp \
  -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

### Prompt-driven workflows

Because the assistant can chain tools together, a single natural-language request can drive a multi-step workflow. A few examples and the tools they trigger:

- **Build an analysis:** “Create a project called NASDAQ vs S&P 100, exploring stock returns for the past two years.” → `create_project` → `create_notebook` → `create_block`
- **Run and inspect:** “Run the Monthly KPIs notebook and tell me what changed.” → `create_run` → `get_run`
- **Audit integration usage:** “Which notebooks query our Snowflake warehouse?” → `list_integrations` → `list_integration_notebook_usages`
- **Tidy a notebook:** “Move the imports block to the top and replace the empty scratch block with a note.” → `get_notebook` → `reorder_notebook_blocks` → `update_block`
- **Clean up a project:** “Delete the scratch notebook in the Q3 forecast project.” → `list_projects` → `get_project` → `delete_notebook`
- **Answer product questions:** “How do I schedule a notebook?” → `list_docs` → `get_doc`

## Security and permissions

- Your workspace API keys or OAuth grants control access. The server can only see and do what the authenticating identity is allowed to.
- Revoking an API key (Settings & members > Security > API keys) or an OAuth grant immediately cuts off the connected client.
- Tools are annotated as read-only or state-changing so well-behaved clients can warn you before making changes.

## Related

- [Deepnote API](/docs/deepnote-api): run notebooks programmatically over REST.
- [Deepnote Agent](/docs/deepnote-agent): Deepnote's built-in AI collaborator inside the notebook.
- [Deepnote plugin in Codex](https://chatgpt.com/plugins/share/449d4e5659914849bfdf87e5c6d51960)
- [OpenAI launch post](https://openai.com/index/codex-for-every-role-tool-workflow/)
- [openai/plugins](https://github.com/openai/plugins)
