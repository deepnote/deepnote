---
title: Deepnote file sync
description: Export your cloud project to a portable .deepnote file and keep it synced
noIndex: false
noContent: false
---

Deepnote file sync lets you export your cloud project to a `.deepnote` file that stays synchronized with your notebooks. This file lives inside a Git repository — you can share it with teammates or run it locally.

The `.deepnote` format is open-source and human-readable (YAML), so you can review notebook changes in pull requests just like regular code.

## Why use file sync?

- **Version control notebooks in Git** — store your notebooks alongside your code and track changes over time
- **Share projects via repositories** — teammates can pull the repo and open the same notebooks locally
- **Run notebooks locally** — use Deepnote Local to execute notebooks without cloud dependency
- **Review notebook changes in PRs** — the file format produces meaningful diffs for code review

## Linking a project

There are two ways to link your project to a `.deepnote` file: export from an existing project, or import from an existing file.

### Export from project

If you have an existing cloud project and want to create a new `.deepnote` file:

1. Open the project menu (three dots) in the top right corner
2. Click **Sync to [repository name]**
3. Deepnote creates a file named `<project-name>.deepnote` in that repository and links it to your project

<Callout status="info">
You need a Git repository connected to your project to see the export option. If you have multiple repositories connected, you'll see an export option for each one.
</Callout>

### Import from existing file

If you already have a `.deepnote` file (for example, from a cloned repository):

1. Navigate to the file in your project's file browser
2. Click on file menu (three dots) and select **Import project from file and link**
3. Confirm the import (this replaces existing notebooks in your project)

<Callout status="warning">
Importing from a file overwrites all notebooks in your current project. Make sure to back up any work you want to keep.
</Callout>

## Sync operations

Once your project is linked, you can sync changes in both directions.

### Automatic sync

Your project automatically syncs to the `.deepnote` file. As you make changes to the project in Deepnote Cloud, those changes will be persisted to file as well.

Similarly, when you pull from remote git repository or switch to different branch, Deepnote will sync notebooks from the file into linked Deepnote Cloud project.

### Manual sync

You can also trigger sync manually from the project menu or from the file ribbon:

- **Sync to file** — Push your current project state to the `.deepnote` file.

- **Sync from file** — Pull changes from the file into your project. Use this after `git pull` or `git checkout` if you performed it from machine's terminal or programmatically from the notebook.

### What gets synced

The sync includes:

- Project name
- All notebooks and blocks inside them
- Connected integrations

<Callout status="info">
Block outputs are not included in the sync. This keeps the file readable and small, making it easier to review in pull requests.
</Callout>

## Unlinking a project

If you want to stop syncing, you can unlink the project:

1. Open the project menu
2. Click **Unlink from .deepnote file**
3. Confirm the action

Unlinking stops the sync but doesn't delete the `.deepnote` file from your filesystem.

## Use cases

### Local development

With .deepnote file sync you can easily bring your notebooks to local machine and back. Use [Deepnote CLI](https://github.com/deepnote/deepnote/tree/main/packages/cli) to run notebooks locally and [Deepnote MCP](https://github.com/deepnote/deepnote/tree/main/packages/mcp) to give your agent (like Claude Code or Cursor) power tools to work with Deepnote files.

1. Clone a repository containing a `.deepnote` file
2. Use [Deepnote extension for VS Code](/docs/vscode-extension) (for humans) or [MCP](https://github.com/deepnote/deepnote/tree/main/packages/mcp) and [CLI](https://github.com/deepnote/deepnote/tree/main/packages/cli) (for agents) to edit and run notebooks.
3. Commit and push your changes back to the repository
4. Pull repository in Deepnote Cloud and see changes synced to your project

### Code review for notebooks

Putting your Deepnote project in a file inside Git repository makes it part of your Git workflow. For example, you now submit and review changes to the notebook as Pull Request. Because the `.deepnote` format is human-readable YAML, notebook changes show up as meaningful diffs in GitHub/GitLab. Similarly, you could run CI on your notebooks.
