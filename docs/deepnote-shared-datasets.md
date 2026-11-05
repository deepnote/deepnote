---
title: Shared datasets
description: Existing shared datasets make large files available to your team across projects.
noIndex: false
noContent: false
---

## What are shared datasets?

Shared datasets make large files available to your team across projects.

<Callout status="info">
Available on Team and Enterprise plans
</Callout>

<Callout status="warning">
You can use existing shared datasets, but you can no longer create new shared dataset integrations.
</Callout>

## Use an existing shared dataset

Files from an existing shared dataset are available at `/datasets/{integration name}` in your notebook. You can query CSV files from this path with Python or SQL. You can also add, remove, or update files in the mounted integration folder. These changes affect every project connected to the shared dataset.

<Callout status="info">
- The shared dataset integration may cause slower performance for a large number of files (e.g., 50+ images). It's better suited for a smaller number of large files.
- The shared datasets integration does not support uploading folders.
</Callout>
