---
title: Microsoft OneDrive
noIndex: false
noContent: false
coverImage: 2WgnsVCRS8esbCqGc2lO
---

Deepnote can fetch files from OneDrive, for example, Excel files that you collaborate on with your team. Follow these docs to create your own notebook to pull files from OneDrive, query data, and visualize it.

### 1. Duplicate the OneDrive template

[Open the template by following this link ->](https://deepnote.com/workspace/Deepnote-Templates-71742312-24f2-4c10-9bf7-786d17280b92/project/Fetch-OneDrive-files-in-Deepnote-7c6d212e-b26d-48ca-a3d0-fcd63f888999/%2Fnotebook.ipynb)

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FuBTyirnZvPcOcczBxtFa%2Fduplicate-notebook.png](https://media.graphassets.com/VoHNl6juQ5qUFurTn0DR)

Click the "duplicate" button on the top right corner to do this. Once you've got the template in your Deepnote workspace, you can download files from OneDrive.

### 2. Share files with Deepnote from OneDrive

You need to create a public sharing link so Deepnote can download the file. [Follow these instructions from Microsoft](https://support.microsoft.com/en-us/office/create-a-shareable-link-8257f6da-d5db-4207-a654-925644e3f35c) making sure that anyone with the link can at least **view** the file.

Change the variable `ONEDRIVE_SHARE_LINK` in the notebook to link to the file you just made.

### 3. Fetch OneDrive files from Deepnote

The template notebook has a function called `get_onedrive_download`, which takes a share link and creates a URL that will download that file directly. You can use a library like `requests` to fetch the file or pass it to `pandas` to read a CSV or Excel file directly. In the below example, the shared file is an Excel file.

```python
ONEDRIVE_SHARE_LINK = "https://1drv.ms/x/s!AjP7y6eiYDDSafV7BusEaDHrI0o?e=cL0Fqi"
df = pd.read_excel(get_onedrive_download(ONEDRIVE_SHARE_LINK))
df
```

When executing the code above, Deepnote will visualize the output DataFrame, as we see in the example below.

<Embed url="https://embed.deepnote.com/7c6d212e-b26d-48ca-a3d0-fcd63f888999/cfcefb8e-a5fb-4326-805a-0f80486b24e0/c241237a12d74a34a26165dabba547b2?height=577" />

### What's next?

Now that you're querying data, you can share it with your team. You can even turn your charts [into a shareable dashboard](/docs/publish-projects).
