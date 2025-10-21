---
title: Microsoft Azure Blob Storage
description: Available to teams and users on all plans
noIndex: false
noContent: false
coverImage: LgGk1HcmTGyMq0mD6TvJ
---

Deepnote can fetch blobs from Azure Blob Storage. Follow these docs to create your own notebook to connect to your storage container.

### 1. Duplicate the Azure Blob Storage template

[Open the template by following this link ->](https://deepnote.com/workspace/Deepnote-Templates-71742312-24f2-4c10-9bf7-786d17280b92/project/Fetch-blobs-from-Azure-in-Deepnote-4c7b1284-0ac9-48df-a35c-415db440d69c/%2Fnotebook.ipynb)

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FuBTyirnZvPcOcczBxtFa%2Fduplicate-notebook.png](https://media.graphassets.com/0ZPojAgrTtefUUQLT0JG)

Click the "duplicate" button on the top right corner to do this. Once you've got the template in your Deepnote workspace, you can connect it to your Synapse workspace.

### 2. Connect to Azure Blob Storage from Deepnote

#### Get the connection string for connecting to your container

To fetch blobs from an Azure storage container, you need a connection string for the container's storage account. Find your connection string [by following these instructions](https://docs.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-python?tabs=environment-variable-windows#copy-your-credentials-from-the-azure-portal).

#### Update the connection string in your notebook

Change the variable `AZURE_BLOG_STORAGE_CONNECTION_STRING` to match the connection string. If you'd like to keep your data secure, consider storing the token as an [environment variable](/docs/environment-variables). Environment variables in Deepnote are encrypted and provide a secure way of storing sensitive data.

#### Update the container name in your notebook

Set `AZURE_BLOB_STORAGE_CONTAINER_NAME` to the name of the container you want to fetch blobs from.

### 3. Fetch Azure blobs from Deepnote

The notebook will set up a `container_client` that you can use to fetch any of the blobs in a container. For example, to get a list of all the blobs.

```python
# Fetch all the blobs and their names
blobs = [*container_client.list_blobs()]
blob_names = [blob.name for blob in blobs]
blob_names
```

When executing the code above, Deepnote will show the `blob_names` result as a list.

<Embed url='https://embed.deepnote.com/4c7b1284-0ac9-48df-a35c-415db440d69c/447156c5-d424-4958-ace2-a835d72b6989/139a8ae4f577454bb5c1497ad32fa209?height=229.5625' />

You can also fetch individual blobs. In our example, our blobs are images (of Mars!), so we generate a thumbnail.

```python
blob_download_stream = container_client.download_blob(blob_names[5])

image = Image.open(io.BytesIO(blob_download_stream.readall()))

image_thumbnail = image.copy()
image_thumbnail.thumbnail([500, 500])
image_thumbnail.show()
```

When executing this, Deepnote will fetch the blob and display the thumbnail.

<Embed url='https://embed.deepnote.com/4c7b1284-0ac9-48df-a35c-415db440d69c/447156c5-d424-4958-ace2-a835d72b6989/dcc96c6f0d7d4c72b60268f53690e682?height=451' />

### What's next?

Now that you're fetching blobs, you can share it with your team. You can even turn your charts [into a shareable dashboard](/docs/publish-projects).

For more information on how to use the Azure SDK, [you can read their docs](https://docs.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-python?tabs=environment-variable-windows).
