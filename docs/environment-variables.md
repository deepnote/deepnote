---
title: Environment variables
noIndex: false
noContent: false
---

You can set environment variables for a project by adding a special type of Integration. Go to **Integrations** in the **right-hand sidebar**, and then either modify an existing "Environment variables" integration or add a new one:

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2Fz86MzyybMGq4fmuWK23c%2FScreen%20Shot%202022-03-30%20at%203.37.14%20PM.png](https://media.graphassets.com/7HB8rqRSXuPSu4BfS96a)

Environment variables are a secure way to store secrets. They are stored encrypted, and decrypted only before mounting them into your project.

Don't forget to connect your project(s) to the newly created "Environment variable" from within the project itself. Once added to the project, you can easily use the Environment Variable from within your notebook:

```python
import os
os.environ.get("VARIABLE_NAME")
```

### Connecting to any service or integration

You might be storing your data in a database that does not yet have a native integration in Deepnote. Or perhaps you need to use a third-party library that issues an API key (e.g. [Mailgun](https://www.mailgun.com/)).

In this case, you can add an environment variable which will let you access the remote integration or third party service. An example is Deepnote's [neptune.ai integration](https://docs.neptune.ai/integrations-and-supported-tools/ide-and-notebooks/deepnote).

<Callout status="warning">
Some integrations can't be used just by including environment variables. [Let us know](https://deepnote.typeform.com/to/agk6aN) if you are looking to use a service like this in Deepnote.
</Callout>

### Environment variables in Terminal

The environment variables from the Integrations are not available in Terminal sessions out of box.

You can use following command in the Terminal to set the environment variables in your Terminal session:

```
source <(/compute-helpers/code/print-integration-env-vars.py)
```

Please note that the environment variables are not automatically injected into the running Terminal sessions when a new integration is connected to your running project. You need to rerun the command above to set the variables.

### Deepnote-specific environment variables

Deepnote automatically provides several environment variables in notebooks, terminals, and Streamlit apps that can be useful for authentication or other workflows:

- **DEEPNOTE_PROJECT_ID**: The unique identifier of the current project. This can be used to generate URLs or for other integrations where project identity is needed.

- **DEEPNOTE_PROJECT_OWNER_ID**: The unique identifier of the project owner. Useful for authentication workflows.

- **DEEPNOTE_RUNTIME_UUID**: A unique identifier for the current runtime session.

- **DEEPNOTE_CPU_COUNT**: The number of CPUs allocated to the project's hardware.

You can access these variables in your notebooks or scripts using:

```python
import os

project_id = os.environ.get("DEEPNOTE_PROJECT_ID")
owner_id = os.environ.get("DEEPNOTE_PROJECT_OWNER_ID")
```
