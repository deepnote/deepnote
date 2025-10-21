---
title: Integrated file system
description: Deepnote has an integrated file system and native integrations to help you work with data files.
noIndex: false
noContent: false
---

## How to upload data files to Deepnote

You can upload files into the integrated file system by dragging them from your computer into the **FILES** section in the right sidebar. You can also click the **+** button to upload files from your computer or from a URL.

![upload files.png](https://media.graphassets.com/ZG2hzoBoTbyNZImXNz8Q)

<br></br>

<Callout status="info">

Note that Deepnote is compatible with core Jupyter functionality. Read our section on [importing and exporting Jupyter notebooks](https://deepnote.com/docs/importing-and-exporting-jupyter-notebooks) to learn more.

</Callout>

Pro tip: If you drag a CSV file into the notebook (either from your computer or from the file system), an [SQL block](/docs/sql-cells) with a prepopulated query will be created for you.

![sql_csv.png](https://media.graphassets.com/OPw0PxhLRXe9FOGO72nq)

<Callout status="info">
Note that the limit for uploading a file via a web interface is 100MB.
</Callout>

## Remote storage

If your files live in a remote service or bucket, you can simply use one of the native [Deepnote integrations](https://deepnote.com/docs/amazon-s3) to access the files. We have integrations with Amazon S3, Google Cloud Storage, Google Drive, Google Sheets, Microsoft OneDrive, Box, Dropbox, and Azure Blob Storage.

## High performance file system

The default working directory (`/work`) is backed by object storage and it is not expected to provide high enough throughput required for working with large amount of smaller files.

If you require high throughput access to your data (i.e. training of ML models using a GPU or unzipping a file) you can switch to a fast ephemeral storage available in `/tmp`. It is recommended to first copy the necessary files from the integrated storage (`/work`) to the ephemeral storage of the project (`/tmp/subdirectory`) before executing the notebook.

Tip: You can do this on [project initialization](https://deepnote.com/docs/project-initialization) by adding a copy statement in the init notebook of your project:

```
!cp -fr /work/<data> /tmp
```

Please note that any files stored in the fast ephemeral storage will be lost when the machine restarts. Don't forget to copy them back to the integrated storage if you want to persist them between restarts.
