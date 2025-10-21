---
title: Bitbucket
noIndex: false
noContent: false
---

Deepnote allows you to both import existing code from Bitbucket (as you would in a local development setting) and sync your code and notebooks with Bitbucket. While there is no built-in integration for Bitbucket yet, setting up and using a Bitbucket repository in Deepnote is fairly straightforward and quick to implement.

<Callout status="info">
If you require full Bitbucket integration to use Deepnote, please let us know by [submitting your request](https://portal.productboard.com/deepnote/1-deepnote-product-portal/tabs/1-under-consideration/submit-idea) or contacting us directly. We are happy to help you integrate Deepnote into your stack!
</Callout>

## Steps to connect to Bitbucket (via ssh)

Every project in Deepnote comes with a filesystem and a terminal. This makes it possible to clone and use any Git repository the same way you would locally. The only challenge is authorization, which we will solve with an SSH key in this tutorial.

If you are fine with passing an access token or password for every Git operation you perform (for example, if you are working on a hobby project or just trying out Deepnote), feel free to skip these steps and clone the repository as you normally would.

1. First, generate a private/public SSH key pair. You can find a tutorial on how to do this in the [Bitbucket documentation](https://support.atlassian.com/bitbucket-cloud/docs/configure-ssh-and-two-step-verification/). Upload the public key to Bitbucket, and use the private key to create an SSH key integration in Deepnote, connecting the integration to your project. The process of creating an SSH integration is described [here](/docs/ssh-key). Connecting the SSH key integration to a project means that the private key will be available in an environment variable.

2. In a terminal (in your Deepnote project), execute `source <(/compute-helpers/code/print-integration-env-vars.py)`. This will ensure that your environment variables are available in the terminal as explained in the documentation.

3. In a terminal, enter `eval "$(ssh-agent)" > /dev/null && echo "$BITBUCKET_SSH_KEY_SSH_KEY" | ssh-add - > /dev/null`. This will add your private SSH key to the machine.

4. Then, in a terminal, clone your repository. For example, use the command `git clone git@bitbucket.org:allan_campopiano/robust_statistics_simulator.git`.

5. That's it! Now you can make changes to the code and push them back to Bitbucket as usual.
