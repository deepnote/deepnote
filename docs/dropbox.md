---
title: Dropbox
noIndex: false
noContent: false
---

Deepnote does not yet offer a native way to integrate, but it's easy enough to use the Python SDK.

### 1. Register a Dropbox API app and create an integration

To use the Dropbox API, you'll need to register a new app in the [App Console](https://www.dropbox.com/developers/apps).

First, choose your app's permissions (before you generate the token). You'll probably need at least `files.metadata.read`, `files.metadata.write`, `files.content.read` and `files.content.write`.

You'll need to use the access token created with this app to access API v2. You can do it on the Settings tab, under OAuth2 section, with **Generate access token**.

Create a new Environment variable integration in Deepnote, and add the access token.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FEemnuVUJ7L37bsgsNTd3%2FScreen%20Shot%202022-03-30%20at%2010.59.24%20AM.png](https://media.graphassets.com/eOOCJnXaRW2l3gQMCh73)

### 2. Try it out

First, install the Python SDK with `pip install dropbox` . Then modify and add this snippet:

```python
import os
import dropbox

dbx = dropbox.Dropbox(os.environ.get("DROPBOX_ACCESS_TOKEN"))

# list files in the root folder
for entry in dbx.files_list_folder('').entries:
    print(entry.name)

# download a file from Dropbox
dbx.files_download_to_file('my_file_in_deepnote.csv', '/my_folder/my_file_in_dropbox.csv')
```
