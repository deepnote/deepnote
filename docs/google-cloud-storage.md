---
title: Google Cloud Storage (GCS)
noIndex: false
noContent: false
---

<Callout status="info">
Available on Team and Enterprise plans
</Callout>

### Connecting to a public bucket

<Callout status="warning">
Make sure the [Cloud Storage API](https://cloud.google.com/endpoints/docs/openapi/enable-api) is enabled in your Google project.
</Callout>

If you are connecting a public bucket, simply fill out the bucket name in the integration modal. After that your bucket will be mounted into your filesystem.

_If you need help with making a bucket public,_ [_here is a tutorial_](https://cloud.google.com/storage/docs/access-control/making-data-public)\_\_

### Connecting to a private bucket

<Callout status="warning">
Make sure the [Cloud Storage API](https://cloud.google.com/endpoints/docs/openapi/enable-api) is enabled in your Google project.
</Callout>

1. In Google Cloud Platform, create a service account and download the key ([guide](https://cloud.google.com/docs/authentication/getting-started)) or re-use an existing one.
2. In Deepnote, create a new Google Cloud Storage integration and enter the name of the bucket. Then copy the contents of the service account into the empty field.
3. After the integration is created, you can connect it to any of your projects. The bucket will be mounted to your file system where you can easily access it.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FkAqRN3pXX0uFOQjZZiiD%2FScreen%20Shot%202022-03-30%20at%2012.55.12%20PM.png](https://media.graphassets.com/Gzv9fdXRQwqlzAkoiWxR)
