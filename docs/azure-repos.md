---
title: Azure Repos
noIndex: false
noContent: false
---

It is possible to import existing code or notebooks from an Azure Repos git repository to Deepnote and sync your code back to the repository. While there is no built-in integration for Azure Repos yet, setting up and using Azure Repos in Deepnote is already fairly straightforward.

<Callout status="info">If you require a full Azure Repos integration to use Deepnote, please let us know!
If you require a full Bitbucket integration to use Deepnote, please let us know by [submitting your request](https://portal.productboard.com/deepnote/1-deepnote-product-portal/tabs/1-under-consideration/submit-idea), or contact us directly. We are happy to help!</Callout>

## How to set it up

Every project in Deepnote comes with a filesystem and a terminal. This makes it possible to clone and use any git repository the same way as you would do locally.

First, you need to get credentials for your repository. In the Azure Repo, navigate to the clone section:

<ImageBorder variant="blue">![azure-deepnote-01.png](https://media.graphassets.com/FsMXfkbaQvC75zP4j7qj)</ImageBorder>

Click on "Generate git credentials". This will generate a one-time access token that will be used for this repository by Deepnote.

<ImageBorder  variant="blue">![azure-repos-01.png](https://media.graphassets.com/x0B3tpvRjSA7y6LEyzJ6)</ImageBorder>

Copy the repository URL and the access token.

In Deepnote, open a terminal and clone the repository the same way you would do it locally.

```bash
git clone  https://youraccount@dev.azure.com/youraccount/repository
```

When asked for a password, use the access token that you've just generated.

That's it! You can now use files in the repository, edit/open them from your notebook or from the File Explorer. If you wish to commit and push/pull the files to the remote, you can use terminal to issue corresponding git CLI commands.
