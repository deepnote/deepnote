---
title: Importing code from GitLab
description: Deepnote allows you to import public and private repositories from GitLab, just as you would with your local computer.
noIndex: false
noContent: false
coverImage: PSzDuqhJT2upZFLaaEDD
---

<Callout status="info">
Available on Team & Enterprise plans. Deepnote by default will connect to GitLab's cloud instance ([gitlab.com](https://gitlab.com/)). Connecting to custom GitLab instance is available for enterprise customers on request.
</Callout>

If you want to include a private or public repository from GitLab, you can add it to your Deepnote project. This allows you and all your project collaborators to sync files from GitLab without touching the terminal.

Remember that when it comes to collaboration, Deepnote provides many native solutions. For example, consider the following use cases for collaboration that don't require GitLab:

- [Sharing notebooks with access controls](/docs/workspaces)
- [Real-time](/docs/real-time-collaboration) and [asynchronous](/docs/comments) notebook collaboration
- [Native versioning of notebooks](/docs/history)

However, Deepnote's GitLab integration makes the following workflows simple:

- Using a private Python module in Deepnote notebooks
- Augmenting local library/package development
- Importing `.ipynb` files from GitLab to Deepnote's native representation

## Setting up GitLab integration

Unlike the GitHub integration which uses a GitHub App, the GitLab integration requires a few setup steps: connecting your personal GitLab account, adding repositories to your workspace, and creating integrations.

### Step 1: Connect your GitLab account

Each user who wants to use GitLab features needs to connect their GitLab account to Deepnote:

1. Go to your **Account Settings**
2. Find the **GitLab** section
3. Click **Connect GitLab account**
4. You'll be redirected to GitLab to authorize Deepnote
5. Grant the necessary permissions and complete the OAuth flow

Once connected, Deepnote will use your GitLab credentials to access repositories on your behalf.

### Step 2: Add repositories to your workspace (Admin only)

Workspace administrators need to add GitLab repositories to the workspace before they can be connected to projects or used in [export integration](/docs/git-export):

1. Go to **Settings**
2. Navigate to the **Workspace** section
3. Find **Connected GitLab repositories** section and click **Connect repositories** or **Manage repositories**
4. Select repositories you'd like your teammates to have access to in this workspace
5. Save changes

Once a repository is added to the workspace, it can be used to:

- Create integrations that can be connected to projects (see below)
- [Export notebooks](/docs/git-export) directly to GitLab

### Step 3: Create a GitLab integration (Admin only)

To connect a GitLab repository to a project, you first need to create an integration. An integration is a reusable preset that specifies which repository and branch to use:

1. Go to **Integrations** page in left sidebar
2. Click **Add integration** and select **GitLab** under **Version control** section
3. Choose a repository from the list of repositories added in Step 2
4. Select the default branch and folder name you want to use and click **Create integration**

Once created, the integration can be connected to any project in your workspace.

## Connecting a repository to a project

After an integration is created, you can connect it to any project:

1. In the project sidebar, click the **+** button in the Files section
2. Select **Connect a GitLab repository**
3. Choose from the available GitLab integrations
4. The repository will be cloned and appear in your project's filesystem

## Git workflow

There are multiple actions you can execute on the connected GitLab repository in the UI:

- **Changing the current branch** - Click on the dropdown with the list of branches and select a branch
- **Pulling the current branch** - Pull the latest changes from the remote
- **Commit & Push** - This will trigger a modal that allows you to specify the commit message and select files to commit
- **Re-Clone** - This will clone the repository from scratch into the same directory. Watch out, you might lose your local changes!
- **Create merge request** - Opens GitLab to create a new merge request for your branch

<Callout status="info">
Keep in mind that you can execute any git command within the repository - just open a terminal, navigate to the repository and execute any `git xxx` command. Your Git commands will be augmented with your access token automatically.
</Callout>

### Authentication under the hood

All GitLab operations in Deepnote are performed using the credentials of the user who initiates the action. This means:

- When you pull, commit, push, or perform any Git operation, Deepnote uses **your** GitLab credentials, regardless of who added the repository to the workspace or created the integration
- If you don't have access to a repository on GitLab, the operation will fail
- Commits will be attributed to your GitLab account

For terminal integration, we use OAuth tokens to authenticate `git` commands. To be able to use this approach, we access the repository via HTTPS protocol rather than SSH. The token grants access to repositories based on your GitLab permissions. We use the [Custom Git Credential Helper](https://git-scm.com/docs/gitcredentials#_custom_helpers) to pass the token to the `git` commands.

## Revoking access

If you no longer want Deepnote to access your GitLab account, you can disconnect it in your Account Settings. Workspace administrators can also remove repositories from the workspace in Workspace Settings.

<Callout status="info">
Follow this [guide](/docs/git-export) to export notebooks to GitLab.
</Callout>
