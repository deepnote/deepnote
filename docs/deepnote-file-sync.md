---
title: Deepnote file sync
description: Export your cloud project to a portable .deepnote file and keep it synced
noIndex: false
noContent: false
---

Deepnote file sync lets you export your cloud project to a `.deepnote` file that stays synchronized with your notebooks. This file lives inside a Git repository — you can share it with teammates or run it locally.

The `.deepnote` format is open-source and human-readable (YAML), so you can review notebook changes in pull requests just like regular code.

<Callout status="warning">
**"Deepnote file sync" and the `deepnote sync` CLI command are two different things.**

- **Deepnote file sync** — this page. An in-product feature that links **one** cloud project to
  **one** `.deepnote` file inside a **connected Git repository**, and keeps the two in step
  automatically. You drive it from the project menu in the Deepnote editor.
- **[`deepnote sync`](/docs/deepnote-cli-sync)** — a local command-line tool. It mirrors **many**
  projects (a whole workspace) into a directory on your machine, **on demand**, and does not involve
  Git at all. You drive it from your terminal and commit anything yourself.

They can be used together, but they are separate mechanisms with separate state. If you are reading
about `.deepnote-sync.json`, `--all-files`, or `--on-conflict`, you want the CLI page.
</Callout>

## Why use file sync?

- **Version control notebooks in Git** — store your notebooks alongside your code and track changes over time
- **Share projects via repositories** — teammates can pull the repo and open the same notebooks locally
- **Run notebooks locally** — use [Deepnote CLI](https://github.com/deepnote/deepnote/tree/main/packages/cli) to execute notebooks without cloud dependency
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
2. Click on the file menu (three dots) and select **Import project from file and link**
3. Confirm the import (this replaces existing notebooks in your project)

<Callout status="warning">
Importing from a file overwrites all notebooks in your current project. Make sure to back up any work you want to keep.
</Callout>

## Sync operations

Once your project is linked, you can sync changes in both directions.

### Automatic sync

Your project automatically syncs to the `.deepnote` file. As you make changes to the project in Deepnote Cloud, those changes will be persisted to the file as well.

Similarly, when you pull from a remote Git repository or switch to a different branch, Deepnote will sync notebooks from the file into the linked Deepnote Cloud project.

### Manual sync

You can also trigger sync manually from the project menu or from the linked file:

- **Sync to file** — Push your current project state to the `.deepnote` file.

- **Sync from file** — Pull changes from the file into your project. Use this after `git pull` or `git checkout` if you performed it from your machine's terminal or programmatically from the notebook.

### What gets synced

The sync includes:

- Project name
- All notebooks and blocks
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

With `.deepnote` file sync, you can easily bring your notebooks to your local machine and back. Use [Deepnote CLI](https://github.com/deepnote/deepnote/tree/main/packages/cli) to run notebooks locally and [Deepnote MCP](https://github.com/deepnote/deepnote/tree/main/packages/mcp) to give your agent (like Claude Code or Cursor) power tools to work with Deepnote files.

1. Clone a repository containing a `.deepnote` file
2. Use [Deepnote extension for VS Code and Cursor](/docs/vscode-extension), [Deepnote MCP](https://github.com/deepnote/deepnote/tree/main/packages/mcp), and [Deepnote CLI](https://github.com/deepnote/deepnote/tree/main/packages/cli) to edit and run notebooks locally.
3. Commit and push your changes back to the repository
4. Pull the repository in Deepnote Cloud and see changes synced to your project

### Code review for notebooks

Adding a Deepnote project file inside your Git repository makes it part of the Git workflow. For example, you can now submit and review changes to the notebook as a pull request. Since the `.deepnote` format is human-readable YAML, notebook changes show up as meaningful diffs in GitHub/GitLab. Similarly, you could run CI on your notebooks.

## Related

- [Syncing a workspace with the Deepnote CLI](/docs/deepnote-cli-sync) — the `deepnote sync` command, which mirrors many projects to a local directory on demand. Use it when you want a whole workspace locally, or when the project you want to work on is not linked to a Git repository.
- [Publishing static sites with the Deepnote CLI](/docs/deepnote-cli-publish) — deploy a built site or app to a project with `deepnote publish`.
- [Deepnote file format](/docs/deepnote-format) — what is inside a `.deepnote` file.
- [How to set up Deepnote locally](/docs/local-setup) — editors and other local tooling.
