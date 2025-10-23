---
title: Export notebooks to Git
description: Deepnote lets you export your notebooks to GitHub and GitLab, enabling additional backup, audit trails, and easier compliance for your work.
noIndex: false
noContent: false
coverImage: CD96IU61Q5mZc7p3Tbw5
---

<Callout status="info">
Available on Team & Enterprise plans
</Callout>

You can easily export all your notebooks in open-source format from Deepnote to GitHub or GitLab without touching the terminal.

Exporting notebooks to GitHub unlocks new possibilities and workflows, such as:

- Archiving or backing up your notebooks.
- Leveraging GitHub to trigger automated testing and deployment pipelines whenever changes are made to your notebooks.
- Keeping independent history of changes to notebooks for easier security review and compliance.

<Callout status="info">
To import code from GitHub and collaborate with your teammates, follow [this guide](/docs/github).
</Callout>

## Connecting GitHub repository

First, open **Version history** sidebar by clicking on the icon in the top right corner. Then click **Connect Git repository** and select GitHub.

![Open version history menu](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgjh0q593lin07n4agr1u2x9)

Deepnote connects to GitHub through a [GitHub app](https://github.com/apps/deepnote).

Click on **"Add GitHub repositories"** to install the Deepnote GitHub app on your organization's or personal GitHub account.

![Add GitHub repositories](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgjh0q4q3k4d07my7bduz742)

In GitHub, you can configure the GitHub App to have access to all your organization's repositories or specific ones. This process only needs to be completed once per GitHub account or organization. Please note that if you use multiple workspaces, you have to complete the process for every workspace.

In case you want to add repositories from another GitHub organization, open the repository dropdown and click on the "Add GitHub repositories" button.

Once the GitHub App is installed, you can select the repository you want to add to Deepnote. In addition to the repository, you need to specify the path to which all the project notebooks will be exported, and the branch to which the changes will be committed & pushed. The branch you specify must exist in the repository.

You also have the option to include notebook outputs in the export, as well as make exports automatic. If automatic export is enabled, Deepnote will export your project every time a new version is created.

![Export settings](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgjh0q553lii07n4soq0yp8j)

### Troubleshooting

#### Repositories not loading

If you don't see your repositories in the list after finishing the authorization process in GitHub, your GitHub organization may already be connected to another workspace in Deepnote. To fix this:

1. Trigger the authorization process again from the new workspace
2. Click on "Configure" button for your organization in GitHub
3. Add the relevant repository in "Repository access" section
4. Click on **Save**. This will connect your GitHub organization to the new workspace.

#### Unable to commit & push

To export the notebook to GitHub, the repository must contain the specified branch, and it can't be empty (it has at least one initial commit).

### Revoking access

If you no longer want Deepnote to access some or all of your repositories, you can either revoke access to some repositories or uninstall the Deepnote GitHub application completely in your organization's GitHub settings at `https://github.com/organizations/<your-organization>/settings/installations`.

## Connecting GitLab repository

<Callout status="info">
Deepnote by default will connect to GitLab's cloud instance ([gitlab.com](https://gitlab.com/)). Connecting to custom GitLab instance is available for enterprise customers on request.
</Callout>

First, open **Version history** sidebar by clicking on the icon in the top right corner. Then click **Connect Git repository** and select GitLab.

![Open version history menu](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgjh0q593lin07n4agr1u2x9)

To use the GitLab integration, you need to connect your GitLab account to your Deepnote account. If you haven't done this already, you can do it directly from the export modal. You also need to have write permissions to the selected repository on GitLab.

Notebooks can be exported to a repository only if it's connected to the current workspace. Workspace admins can manage connected repositories in the workspace settings. If your workspace doesn't have connected repositories yet, you will be prompted to add them.

![Connect GitLab repositories](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgjh0q4q3li907n4rdy5cnn4)

Once you have a repository connected to the workspace, you can select it as an export destination. In addition to the repository, you need to specify the path where all the project notebooks will be exported and the branch where the changes will be committed and pushed. The branch you specify must already exist in the repository.

You also have the option to include notebook outputs in the export, as well as make the export automatic. If automatic export is enabled, Deepnote will export the project every time a new version is created.

![Export settings](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgjh0q5z3k4y07my0e0krly1)

### Managing connected GitLab account

In Deepnote, all communication with the GitLab API is made on behalf of the user who initiates the action (e.g., notebook export). You can manage your connected GitLab account in Account settings (click on your user picture in the top right corner and select **Account settings**). This account is shared between your different workspaces.

### Managing connected workspace GitLab repositories

In Deepnote, users are able to use GitLab repositories only if they are explicitly connected to the workspace.

To connect a new repository, you need to have GitLab connected to your account and to have at least "Develop" level access to the repository on GitLab. Navigate to **Settings & members** > **Workspace** and you'll see a list of already connected repositories with the option to connect new ones or disconnect existing ones.

Disconnecting the repository won't affect already configured export settings, but users won't be able to export affected projects without reconfiguration (unless you reconnect the repository).

![Manage workspace GitLab repositories](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgjh79uo3ohi07myfyllcd8q)

## Exporting notebooks

To export all project notebooks to the connected repository, click the **Commit & push** button.

![Commit & push button](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgjh0q4j3k4607my1zsjjwu4)

Add the commit message with a description, and export it.

Once exported, all project notebooks will be in the connected Git repository. The notebooks are saved in the open .ipynb format. Note that, depending on your configuration, the block outputs, which may contain sensitive data, may be exported too. If you wish to not commit the output of a specific block, you can clear the output of that specific block before committing or adjust your export configuration.

The commits that Deepnote creates are based on the latest commit in the remote branch, and no files other than the notebooks are overwritten. It is possible to use the same GitHub repository for multiple Deepnote projects — and also for other tools you might be using to export your code.

Git exports are also integrated into Deepnote's [native versioning functionality](/docs/history). Each commit creates a new version of the project, which you can quickly preview or restore from the project version history.

![Commit & push modal](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgjh0q583k4t07my43hbquye)
