---
title: Shared datasets
description: Existing shared datasets store large files in a Deepnote-managed Google Cloud Storage bucket and make them available across projects.
noIndex: false
noContent: false
---

## What are shared datasets?

Shared datasets store large files in a Google Cloud Storage bucket managed by Deepnote. Files in an existing shared dataset are available to your team across projects.

<Callout status="info">
Available on Team and Enterprise plans
</Callout>

<Callout status="warning">
Creating new shared datasets integrations is no longer supported. Existing shared datasets continue to work as usual, but new ones can't be created.
</Callout>

## Use an existing shared dataset

Files from an existing shared dataset are available at `/datasets/{integration name}` in your notebook. You can query CSV files from this path with Python or SQL. You can also add, remove, or update files in the mounted integration folder.

<Callout status="info">
- The shared dataset integration may cause slower performance for a large number of files (e.g., 50+ images). It's better suited for a smaller number of large files.
- The shared datasets integration does not support uploading folders.
</Callout>
