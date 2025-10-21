---
title: BigQuery with Google OAuth
description: Deepnote allows each user to authenticate to Google BigQuery using their own credentials.
noIndex: false
noContent: false
---

## What can you do with BigQuery's Google OAuth?

<Callout status="info">
Available on Enterprise plan
</Callout>

With BigQuery's Google OAuth authentication you can give every member of your Deepnote workspace their own set of credentials. This ensures greater security by using short-lived tokens and enabling the use of multi-factor authentication. Follow the principle of least privilege and use granular access control for various BigQuery resources to ensure users can only access the data they need.

### Setting up OAuth for BigQuery in Deepnote

To set up authentication to BigQuery via OAuth, navigate to the [Google Cloud console](https://console.cloud.google.com) and complete the following steps:

1. Click **API & Services** Section and select **Credentials** from the left side bar
2. Click **Create Credentials** and select **OAuth Client ID**
3. If this is the first one, you will need to **Configure Consent Screen** by following the steps. Pick options that make sense for your organization. If you are not sure, you can pick these:
   1. Select user type: **Internal**
   2. Set **Your company OAuth** as name, and add your own email as support email and developer contact information
   3. You do not need to add any scopes
   4. Click **Save and continue**, and return to creating credentials
4. For Application type, choose **Web Application**
5. Fill in the **Name** field, for example `Deepnote OAuth`
6. In Redirect URIs, click on Add URI and enter

   ```
   https://deepnote.com/auth/bigquery/google-oauth-callback
   ```

   as redirect URI

7. Click **Create**
8. From the newly created Client, copy `CLIENT_ID` and `CLIENT_SECRET`

👉 Now head back to Deepnote and add the Client ID, Client Secret, and Project ID to the Google Big Query integration pop up. You will of course need to make sure you've selected Google OAuth as the authentication method.
![gbq_oauth_fill.png](https://media.graphassets.com/nStDWWqlQgGp73sYYZ6Y)

### Querying data with user-specific authentication

Since every user will have to authenticate using their own Google account with this method, the notebook provides a few ways to accomplish authentication (also see the image below). Any of the following actions will initiate authentication for a given user:

- Pressing the **Authenticate** button on a SQL block
- 2. Clicking **Authenticate integration** from three-dot menu of the integration in the right sidebar
- 3. Responding to a request for authentication when executing an SQL block

![gbq_authenticate.png](https://media.graphassets.com/oQtF3hYJShWVLELDxB3T)

When you create an app from a notebook that uses the integration, every app user will need to authenticate with their own account. They will be prompted to sign in using Google during the execution of the app. The results they see will depend on the permissions they have.

<Callout status="info">
- User authentication is also required to browse the BigQuery schema.
- Scheduling a project with a BigQuery OAuth integration connected is not supported, since it requires an interactive authentication flow. To use scheduling, create a BigQuery integration with [service account authentication.](google-bigquery#authenticating-with-a-service-account)
</Callout>
