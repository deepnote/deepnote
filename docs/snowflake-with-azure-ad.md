---
title: Snowflake with Azure AD
description: Deepnote allows each user to authenticate to Snowflake using their own credentials.
noIndex: false
noContent: false
---

<Callout status="info">
Available on the Enterprise plan
</Callout>

## Greater security with Azure AD authentication

With Snowflake and Azure AD authentication you can give every member of your Deepnote workspace their own set of credentials. You can ensure higher security by using short-lived tokens and enabling the use of multi-factor authentication. Follow the principle of least privilege and use granular access control for various Snowflake resources to ensure everyone can only access the data they need.

The integration leverages [Snowflake's External OAuth with Azure AD](https://docs.snowflake.com/en/user-guide/oauth-azure).

<Callout status="info">
To use Azure AD authentication, you require `SYSADMIN` or `SECURITYADMIN` privileges in Snowflake.
</Callout>

### How to set up the integration with Azure AD authentication

There are a number of steps to follow which will be described in the following sections. Some steps are optional and will be noted as such.

- [Create Snowflake OAuth Resource application](snowflake-with-azure-ad#create-snowflake-oauth-resource-application)
- [Create Snowflake OAuth Client application](snowflake-with-azure-ad#create-snowflake-oauth-client-application)
- [Collect Azure AD information for Snowflake integration](snowflake-with-azure-ad#collect-azure-ad-information-for-snowflake-integration)
- [Create Security integration in Snowflake](snowflake-with-azure-ad#create-security-integration-in-snowflake)
- [Create Snowflake integration in Deepnote](snowflake-with-azure-ad#create-snowflake-integration-in-deepnote)

#### Create Snowflake OAuth Resource application

1. Navigate to the [Microsoft Azure Portal](https://portal.azure.com/) and authenticate.
2. Navigate to Azure Active Directory.
3. Click on **App Registrations** & click on **New Registration**.
4. Enter `Snowflake OAuth Resource`, or similar value as the Name.
5. Verify the Supported account types is set to Single Tenant (My organization only).
6. Click **Register**.
7. In the Overview section, note the `ClientID` from the Application (client) ID field. This will be known as the `<RESOURCE_ID>` in the following steps.
8. Click on **Expose an API**.
9. Click on the **Set link** next to Application ID URI to set the `Application ID URI`. Accept the default value (it will look like `api://${RESOURCE_ID}`).
10. **Optional**: If you wish to only allow specific Snowflake roles to log in via Azure AD, create a scope for each role.
    - Click on **Add a scope** to add a scope representing the Snowflake role.
    - Enter the scope by having the name of the Snowflake role with the `session:scope:` prefix. For example, for the Snowflake Analyst role, enter `session:scope:analyst`.
    - Select who can consent.
    - Enter a display name and description for the scope and click Add Scope

#### Create Snowflake OAuth Client application

1. Navigate back to **App Registrations** page and click on **New Registration**
2. Enter a name for the client application such as `Snowflake OAuth Client`.
3. Verify the Supported account types is set to Single Tenant (My organization only).
4. Click Register. In the Overview section, copy the `ClientID` from the Application (client) ID field. This will be known as the `<OAUTH_CLIENT_ID>` in the following steps.
5. Click on Certificates & secrets and then New client secret.
6. Select expiration. **Warning:** your Azure AD OAuth integration will stop working past the expiration date. Select _Never expire_ if you want to avoid this, however, bear in mind the security considerations.
7. Click Add. Copy the secret. This will be known as the `<OAUTH_CLIENT_SECRET>` in the following steps.
8. Click on Redirect URIs and add a new Web Redirect URI for Deepnote `https://deepnote.com/auth/snowflake/azuread-callback`
9. Click on API Permissions & Add Permission.
10. **Optional:** Follow these steps if you chose to only allow specific Snowflake roles to log in via Azure AD (as noted in the section above).

    - Select **My APIs**.
    - Click on the Snowflake OAuth Resource that you created earlier.
    - Click on the **Delegated Permissions** box.
    - Check the permission related to the scopes that you wish to grant to this client.
    - Click **Add Permissions**.
    - Click on the **Grant Admin Consent** button to grant the permissions to the client.
    - Click **Yes**.

#### Collect Azure AD information for Snowflake integration

1. Navigate to the overview of the Snowflake OAuth Resource application you’ve created earlier.
2. Click on **Endpoints**.
3. On the right-hand side, note the URLs for OpenID Connect metadata and Federation Connect metadata.
   - In a new browser window for the OpenID Connect metadata.
   - Locate the `jwks_uri` parameter and copy its value.
   - This parameter value will be known as the `<AZURE_AD_JWS_KEY_ENDPOINT>` in the following configuration steps. The endpoint
     should be similar to `https://login.microsoftonline.com/90288a9b-97df-4c6d-b025-95713f21cef9/discovery/v2.0/keys`.
   - In a new browser window, open the Federation metadata document.
   - Locate the `entityID` parameter in the `XML Root Element` and copy its value.
   - This parameter value will be known as the `<AZURE_AD_ISSUER>` in the following configuration steps. The entityID value should
     be similar to `https://sts.windows.net/90288a9b-97df-4c6d-b025-95713f21cef9/`. Don’t forget to copy it with the trailing slash.

#### Create Security integration in Snowflake

1. **Optional:** Set `external_oauth_any_role_mode = 'DISABLE'` below if you want your integration to only work with specific Snowflake roles (defined as "scopes" in [the first section above](snowflake-with-azure-ad#create-snowflake-oauth-resource-application)).
2. Execute this code in Snowflake:

   ```
   create security integration external_oauth_azure
       type = external_oauth
   		external_oauth_any_role_mode = 'ENABLE'
       enabled = true
       external_oauth_type = azure
       external_oauth_issuer = '<AZURE_AD_ISSUER>'
       external_oauth_jws_keys_url = '<AZURE_AD_JWS_KEY_ENDPOINT>'
       external_oauth_audience_list = ('<RESOURCE_ID>')
       external_oauth_token_user_mapping_claim = 'upn'
       external_oauth_snowflake_user_mapping_attribute = 'login_name';
   ```

#### Create Snowflake integration in Deepnote

1.  After heading back to Deepnote, create a Snowflake integration as described in our main [Snowflake docs](snowflake).

2.  Select Azure AD as the authentication method and fill in **Client ID** and **Client Secret** based on `<OAUTH_CLIENT_ID>` and `<OAUTH_CLIENT_SECRET>` defined in [the section above](snowflake-with-azure-ad#create-snowflake-oauth-client-application).

3.  Fill in **Resource** as the `<RESOURCE_ID>` of your Snowflake OAuth Resource application from step 7 of [the first section](snowflake-with-azure-ad#create-snowflake-oauth-resource-application).

4.  Fill in **Tenant** as the `Tenant ID` from your Azure AD Overview page.

5.  **Optional:** If you set `external_oauth_any_role_mode = 'DISABLE'` when creating security integration in Snowflake, you must fill in **Role** as one of the roles defined as Azure AD scope (just add the role name, without the `session:scope` prefix).

6.  Lastly, click "Create integration".

<Callout status="info">
- If you leave the **Role** empty, Snowflake will use the default role assigned to each user. If you enter a role, Deepnote will use that role when signing in every user.
- When signing in to your Snowflake integration in Deepnote, make sure that your Azure AD email matches the `LOGIN_NAME` field of your Snowflake account.
</Callout>

### Using the the Snowflake integration with Azure AD

In order to use the integration, every user will have to authenticate using their own Snowflake account. They can do it either by pressing the button on a SQL block with this integration, in the three-dot menu of the integration in the right sidebar, or by responding to a prompt when they execute a SQL block.
![azure_ad_snowflake_auth.png](https://media.graphassets.com/Xhw4oFmScOKeEyqaQ0FR)

When you create an app from a notebook that uses the integration, every app user will need to authenticate with their own account. They will be prompted to sign in using Azure AD during the execution of the app. The results they see will depend on the permissions they have.

<Callout status="info">
- User authentication is also required to browse the Snowflake schema.
- Scheduling a project with this authentication method is not supported since it requires an interactive authentication flow. To use scheduling, create a Snowflake integration with username and password as the authentication method.
</Callout>
