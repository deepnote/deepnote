---
title: SSH key
noIndex: false
noContent: false
---

<Callout status="info">
If you want to create an SSH tunnel to your database, or internal service, we recommend using either built-in SSH tunneling capability in a supported [Database integration](https://deepnote.com/docs/securing-connections#using-ssh-to-connect-to-your-data), or use a standalone [SSH Tunnel](https://deepnote.com/docs/securing-connections?#ssh-tunnel-integration) integration.
</Callout>

SSH key integration is the recommended way to store SSH keys in Deepnote. When you connect the integration to a project, Deepnote will add your private key as environment variable so you can use it to connect to remote machines, or create tunnels to service within cloud services not accessible on public internet.

This integration is useful if you already have a private key you want to use to connect to a private network, and you are not able to add the public key of your Deepnote workspace to the remote resource.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2Ftx9JBkYu6gwXGSzSeJpH%2FScreen%20Shot%202022-03-30%20at%203.45.17%20PM.png](https://media.graphassets.com/HcZgT1zlTXy35hinmgpH)

Copy the private key (commonly stored as `.pem` file) to the text box and give descriptive name to the integration (eg. AWS Redshift Tunnel key). After the integration is created, connect it to your project. Below is an example of using the key with an `ssh-agent`.

<Callout status="info">
Replace `$TEST_SSH_KEY` with your integration's environment variable. To see the variable name, connect the integration to your project and click on "How to use" button.
</Callout>

```
eval "$(ssh-agent)" > /dev/null && \
source <(/compute-helpers/code/print-integration-env-vars.py) && \
echo "$TEST_SSH_KEY" | ssh-add - > /dev/null && \
ssh <user>@<host>
```
