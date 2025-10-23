---
title: Importing code from GitHub
description: Deepnote allows you to import public and private repositories from GitHub, just as you would with your local computer.
noIndex: false
noContent: false
coverImage: CD96IU61Q5mZc7p3Tbw5
---

<Embed url="https://www.loom.com/embed/aba5f2f4101243ad8da43ad7ed65e038?sid=ebabb492-285b-49bd-a977-5c7ed0746d5d"/>

<Callout status="info">
Available on Team & Enterprise plans
</Callout>

If you want to include a private or public repository, you can add it to your Deepnote project. This allows you and all your project collaborators to sync files from GitHub without touching the terminal.

Remember that when it comes to collaboration, Deepnote provides many native solutions. For example, consider the following use cases for collaboration that don't require GitHub:

- [Sharing notebooks with access controls](/docs/workspaces)
- [Real-time](/docs/real-time-collaboration) and [asynchronous](/docs/comments) notebook collaboration
- [Native versioning of notebooks](/docs/history)

However, Deepnote's GitHub integration makes the following workflows simple:

- Using a private Python module in Deepnote notebooks
- Augmenting local library/package development
- Importing `.ipynb` files from GitHub to Deepnote's native representation

## Adding a repository

Deepnote connects to GitHub through a [GitHub app](https://github.com/apps/deepnote).

First, Click **"Add GitHub repositories"** to install the Deepnote GitHub app on your organization's or personal GitHub account.

![GitHub1.png](https://media.graphassets.com/1lYJO7WvQIGtuwQzrOaD)

In GitHub, you can configure the GitHub App to have access to all your organization's repositories or specific ones. This process only needs to be completed once per GitHub account or organization. Please note that if you use multiple workspaces, you have to complete the process for every workspace.

In case you want to add repositories from another GitHub organization, open the repository dropdown and click on the "Add GitHub repositories" button.

Once the GitHub App is installed, you can select the repository you want to add to Deepnote. You can also specify a branch or commit that you want to use.

![GitHub2.png](https://media.graphassets.com/p1SHGzKlTuq9575czGCC)

#### Troubleshooting

If you don't see your repositories in the list after finishing the authorization process in GitHub, your GitHub organization may already be connected to another workspace in Deepnote. To fix this:

1. Trigger the authorization process again from the new workspace
2. Click on "Configure" button for your organization in GitHub
3. Add the relevant repository in "Repository access" section
4. Click on **Save**. This will connect your GitHub organization to the new workspace.

#### Public repositories

To use code from a public repository as an integration, fork the repository to your GitHub organization and use that repository.

Alternatively, it is also possible to clone a public repository via a [terminal](/docs/terminal).

### Git workflow

There are multiple actions you can execute on the connected GitHub repository in the UI. To see them in action, you can view the video at the beginning on this page.

- Changing the current branch. Just click on the dropdown with list of the branches and select a branch!
- Pulling the current branch from the remote
- Commit & Push to the remote (this will trigger a modal that will allow you to specify the commit message)
- Re-Clone - this will clone the repository from scratch into the same directory. Watch out, you might loose your local changes!

After executing any git command, you'll notice that output from the underlying git command that was executed.

<Callout status="info">
Keep in mind that you can execute any git command within the repository - just open a terminal, navigate to the repository and execute any `git xxx` command. Your Git commands will be augmented with access token automatically.
</Callout>

### Authentication under the hood

We use short-lived [access tokens](https://docs.github.com/en/developers/apps/authenticating-with-github-apps) to authenticate `git` commands. To be able to use this approach, we access the repository via HTTPS protocol rather than SSH. The token is valid for 1 hour and only grants access to the repository linked to the given project. We use the [Custom Git Credential Helper](https://git-scm.com/docs/gitcredentials#_custom_helpers) to pass the token to the `git` commands.

## Revoking access

If you no longer want Deepnote to access some or all of your repositories, you can either revoke access to some repositories or uninstall the Deepnote GitHub application completely in your organization's GitHub settings at `https://github.com/organizations/<your-organization>/settings/installations`.

We also verify if the person who linked the GitHub repository to a Deepnote project still has access to the GitHub repository. This means that if somebody leaves your organization or no longer has access to the repository in question, they'll no longer be able to access it through Deepnote.

<Callout status="info">
Follow this [guide](/docs/git-export) to export notebooks to GitHub.
</Callout>
