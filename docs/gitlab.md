---
title: GitLab
noIndex: false
noContent: false
coverImage: PSzDuqhJT2upZFLaaEDD
---

<Callout status="info">
**Want to get started right away?** Jump right in and explore [this hands-on example](https://deepnote.com/@deepnote/GitLab-b44caee9-23c0-49fe-a31c-15820d4ae453) of using GitLab in Deepnote.
</Callout>

Deepnote allows you to both import existing projects from GitLab (as you would in a local development setting) and sync your code and notebooks to GitLab. While there's no built-in integration for GitLab, setting up and using GitLab in Deepnote is fairly straightforward and quick to implement!

![GitLab workflow](https://media.graphassets.com/1hGbe5udR92VZq6AsMTL)

### How to set it up

There are three core steps to starting to work with GitLab in Deepnote. Let's go through them one by one.

1. **Generate an SSH key**
   - This can be done either directly in Deepnote or somewhere else and then uploaded to Deepnote. The SSH key should be stored somewhere in the `~/work` directory to ensure it does not get deleted after a hardware reboot. We will store it in `~/work/git-ssh-key`.
   - If you'd like to create the SSH key in Deepnote, you can run `!ssh-keygen -t rsa -N "" -C "Deepnote key" -f ~/work/git-ssh-key`
2. **Create a deploy key in GitLab**
   - Retrieve the contents of the public key we just created in `~/work/git-ssh-key.pub`
   - Take the output of the above cell and create a new [Deploy Key](https://docs.gitlab.com/ee/user/project/deploy_keys/) at [https://gitlab.com/YOUR_ORG/YOUR_REPO/-/settings/repository](https://gitlab.com/YOUR_ORG/YOUR_REPO/-/settings/repository). Depending on whether you only want to `pull` the code in Deepnote or also have the capability to `push` new code, check the `Grant write permissions to this key` in GitLab's UI.
3. **Create environment variables**
   - Set the `GIT_SSH_COMMAND` environment variable to `ssh -i ~/work/git-ssh-key` using [Environment Variables](/docs/environment-variables). Environment variables in Deepnote are encrypted and offer a secure option to store sensitive data.

### How to use

Now that you've set up everything required to use GitLab in Deepnote, getting started is as easy as cloning a repository from GitLab and performing the workflows you're used to on your local machine!

### Next steps

Jump right in and explore [this hands-on example](https://deepnote.com/@deepnote/GitLab-b44caee9-23c0-49fe-a31c-15820d4ae453) of using GitLab in Deepnote. You can also save yourself some setup work by hitting the `View source` button first before clicking on `Duplicate` in the top-right corner to start exploring on your own!
