---
title: Version history
noIndex: false
noContent: false
---

Deepnote lets you preview and restore older versions of notebooks in the _Project version history_. You can also view everything that has happened in a project in the _Versions_ sidebar.

You will need edit- or admin-level access to the project in order to view its history.

### Project version history

You can find the Project version history in the three-dot menu in the top-right corner of a project. You can preview older version of all notebooks inside of a project.

![project version history](https://media.graphassets.com/EYHGtgSOarcr4CilcDQq)

#### Version creation

New version are created in two ways:

- **Automatic**. When you're working on a project, a new version is automatically created every 10 minutes. Another version will be created when you stop—after 2 minutes of inactivity.
- **Manual**. You can open the Versions sidebar from the top left part, and press a plus button in the sidebar to create a named version.

#### Restoring a version

You can navigate to an older version of the project and restore the notebooks to their previous state. Restoring is a safe operation, and performs several steps:

- Create a snapshot of the current state. This makes it possible to return back without losing any code.
- Overwrite all notebooks with their old versions. Notebooks created since then will be removed, and removed notebooks will be recovered.

Since notebooks sometimes depend on each other, restoring a version always restores all notebooks at the same time.

If you'd like to keep multiple versions of a project, duplicate it at various points in time.

### Versions

Open the Versions sidebar by clicking on the Versions icon in the top menu on the right side.

You can see actions done by all collaborators and significant system events.

If an action log is associated with a specific notebook, you can click on the action and you will be focused on the notebook where the change was made.

### Filesystem snapshots (deprecated)

Deepnote no longer versions the rest of the files in your project. If you were relying on this feature and need to restore some project files, please reach out to Deepnote's support.
