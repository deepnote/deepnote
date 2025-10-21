---
title: Google Drive
description: If you store spreadsheets and CSVs in Google Drive, our native integration makes it easy to access these files from within Deepnote.
noIndex: false
noContent: false
---

## How to use the Google Drive integration

There is a two-step process for setting up the Google Drive integration:

1. Grant Deepnote permission to access the files.
2. Connect the integration to your desired project.

From there you will be able to use Python to read the files into your notebook.

As with all integrations, once you set up the Google Drive integration, members of your workspace will be able to connect it to any project (if they have the appropriate permissions to do so).

Let's set it all up and look at some examples of working with files from Google Drive.

### Authorizing & connecting

First, click the **Integrations** section in the left panel and find the Google Drive entry in the list of native integrations (you can also create new integrations in the **Integrations** area in the right panel).

![choose_gd.png](https://media.graphassets.com/D43WydjvRT6fAPBdq2cW)

You will be taken through the authorization flow (via OAuth). Once Deepnote is authorized to access the files, connect the Google Drive to your desired project as shown below.

![connect_gd_to_proj.png](https://media.graphassets.com/9ukMIblxTKGLZT0Wb55R)

<Callout status="success">

The access credentials are encrypted and stored securely in our database. You can revoke access by revisiting the Google Drive integration pop-up and clicking **Revoke access**.

</Callout>

### Accessing a Shared Drive

To access a Shared Drive within your workspace, set the Team Drive ID in the Integration settings. You may
get the Drive ID from the URL of the Drive.

### Working with files in Google Drive

Once Google Drive is connected to your project, it will be mounted to the `/datasets/` folder. It is now a simple matter to use pandas (or other standard Python commands) to read the files into your notebook and begin working with them.

Here's an example using pandas to read a CSV from Google Drive into the notebook:

![gd_data.png](https://media.graphassets.com/tmKxV9zJRMOMZqbqQHz0)

<Callout status="info">

💡 You can also use the Google API to read Google Sheets directly into the notebook. Please see these examples to learn how to read a [public](https://deepnote.com/workspace/Subspace-Analytics-3e79b326-0cf6-4bff-8b41-99d9feb9b992/project/Read-from-public-Google-Sheet-25da9f7e-82e2-416c-827a-514b802bb1a1/notebook/notebook-2044ad29f11c47adae4ed1baf900262f) and [private](https://deepnote.com/workspace/edison-insights-3e79b326-0cf6-4bff-8b41-99d9feb9b992/project/Read-from-a-private-Google-Sheet-faa77a5d-72a1-46cb-9a20-7ee446de7f58/notebook/Notebook%201-4428c941a1f14b6a9e222828ff260fd5) Google sheet into Deepnote.

</Callout>
