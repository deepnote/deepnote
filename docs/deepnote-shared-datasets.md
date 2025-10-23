---
title: Shared datasets
description: The shared datasets integration can be used to store your team's large data files and make them available across all projects.
noIndex: false
noContent: false
---

## What can you do with the shared datasets integration?

When you don't have a bucket of your own (or your files are too large for the integrated file system), the shared datasets integration is a good option. Under the hood, it's simply a Google Cloud Storage bucket that Deepnote manages for you. Since this integration is a bucket, it means that the files stored here will be available for your whole team across all projects.

<Callout status="info">
Available on Team and Enterprise plans
</Callout>

## How to use the shared datasets integration

From the right-hand panel, under **Integrations**, click the **+** button and choose **Create new integration**. Select **Upload large files or datasets**.
![shared_data_select.png](https://media.graphassets.com/ztkuOdWHRzyFoskumQGA)

<br></br>

Upload your files into a shared dataset by dragging and dropping them into the drop zone. Give your integration a name and you're good to go.
![datasets_modal.png](https://media.graphassets.com/slsVwOhTQbuAIOpHvpJ3)

<br></br>

Your files are now available on the path `/datasets/{integration name}` in your notebook as shown below (query any CSVs with Python and SQL). You can also edit the data stored by adding, deleting, or modifying it directly in the mounted integration folder.
![datasets_frame.png](https://media.graphassets.com/miLOoSenSR6hvhOEZ4OK)

<Callout status="info">
- The shared dataset integration may cause slower performance for a large number of files (e.g., 50+ images). It's better suited for a smaller number of large files.
- The shared datasets integration does not support uploading folders.
</Callout>
