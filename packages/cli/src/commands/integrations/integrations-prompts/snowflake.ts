import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import { SnowflakeAuthMethods } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import {
  promptForOptionalSecretField,
  promptForOptionalStringField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
} from '../../../utils/inquirer'

export async function promptForFieldsSnowflake({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'snowflake'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['snowflake']
}): Promise<DatabaseIntegrationConfig> {
  const accountName = await promptForRequiredStringField({
    label: 'Account Name:',
    defaultValue: defaultValues?.accountName,
  })

  const currentAuthMethod =
    defaultValues && 'authMethod' in defaultValues && defaultValues.authMethod
      ? defaultValues.authMethod
      : SnowflakeAuthMethods.Password

  const authMethod = await select({
    message: 'Authentication method:',
    default: currentAuthMethod,
    choices: [
      { name: 'Password', value: SnowflakeAuthMethods.Password },
      { name: 'Okta', value: SnowflakeAuthMethods.Okta },
      { name: 'Native Snowflake OAuth', value: SnowflakeAuthMethods.NativeSnowflake },
      { name: 'Azure AD', value: SnowflakeAuthMethods.AzureAd },
      { name: 'Key Pair', value: SnowflakeAuthMethods.KeyPair },
      { name: 'Service Account Key Pair', value: SnowflakeAuthMethods.ServiceAccountKeyPair },
    ],
  })

  let authMetadata: Partial<DatabaseIntegrationMetadataByType['snowflake']> = {}

  if (authMethod === SnowflakeAuthMethods.Password) {
    const username = await promptForRequiredStringField({
      label: 'Username:',
      defaultValue: defaultValues && 'username' in defaultValues ? defaultValues.username : undefined,
    })
    const password = await promptForRequiredSecretField({
      label: 'Password:',
      defaultValue: defaultValues && 'password' in defaultValues ? defaultValues.password : undefined,
    })
    authMetadata = { authMethod: SnowflakeAuthMethods.Password, username, password }
  } else if (authMethod === SnowflakeAuthMethods.Okta) {
    const clientId = await promptForRequiredStringField({
      label: 'Client ID:',
      defaultValue: defaultValues && 'clientId' in defaultValues ? defaultValues.clientId : undefined,
    })
    const clientSecret = await promptForRequiredSecretField({
      label: 'Client Secret:',
      defaultValue: defaultValues && 'clientSecret' in defaultValues ? defaultValues.clientSecret : undefined,
    })
    const oktaSubdomain = await promptForRequiredStringField({
      label: 'Okta Subdomain:',
      defaultValue: defaultValues && 'oktaSubdomain' in defaultValues ? defaultValues.oktaSubdomain : undefined,
    })
    const identityProvider = await promptForRequiredStringField({
      label: 'Identity Provider:',
      defaultValue: defaultValues && 'identityProvider' in defaultValues ? defaultValues.identityProvider : undefined,
    })
    const authorizationServer = await promptForRequiredStringField({
      label: 'Authorization Server:',
      defaultValue:
        defaultValues && 'authorizationServer' in defaultValues ? defaultValues.authorizationServer : undefined,
    })
    authMetadata = {
      authMethod: SnowflakeAuthMethods.Okta,
      clientId,
      clientSecret,
      oktaSubdomain,
      identityProvider,
      authorizationServer,
    }
  } else if (authMethod === SnowflakeAuthMethods.NativeSnowflake) {
    const clientId = await promptForRequiredStringField({
      label: 'Client ID:',
      defaultValue: defaultValues && 'clientId' in defaultValues ? defaultValues.clientId : undefined,
    })
    const clientSecret = await promptForRequiredSecretField({
      label: 'Client Secret:',
      defaultValue: defaultValues && 'clientSecret' in defaultValues ? defaultValues.clientSecret : undefined,
    })
    authMetadata = { authMethod: SnowflakeAuthMethods.NativeSnowflake, clientId, clientSecret }
  } else if (authMethod === SnowflakeAuthMethods.AzureAd) {
    const clientId = await promptForRequiredStringField({
      label: 'Client ID:',
      defaultValue: defaultValues && 'clientId' in defaultValues ? defaultValues.clientId : undefined,
    })
    const clientSecret = await promptForRequiredSecretField({
      label: 'Client Secret:',
      defaultValue: defaultValues && 'clientSecret' in defaultValues ? defaultValues.clientSecret : undefined,
    })
    const resource = await promptForRequiredStringField({
      label: 'Resource:',
      defaultValue: defaultValues && 'resource' in defaultValues ? defaultValues.resource : undefined,
    })
    const tenant = await promptForRequiredStringField({
      label: 'Tenant:',
      defaultValue: defaultValues && 'tenant' in defaultValues ? defaultValues.tenant : undefined,
    })
    authMetadata = { authMethod: SnowflakeAuthMethods.AzureAd, clientId, clientSecret, resource, tenant }
  } else if (authMethod === SnowflakeAuthMethods.KeyPair) {
    authMetadata = { authMethod: SnowflakeAuthMethods.KeyPair }
  } else {
    const username = await promptForRequiredStringField({
      label: 'Service Account Username:',
      defaultValue: defaultValues && 'username' in defaultValues ? defaultValues.username : undefined,
    })
    const privateKey = await promptForRequiredSecretField({
      label: 'Private Key (PEM):',
      defaultValue: defaultValues && 'privateKey' in defaultValues ? defaultValues.privateKey : undefined,
    })
    const privateKeyPassphrase = await promptForOptionalSecretField({
      label: 'Private Key Passphrase:',
      defaultValue:
        defaultValues && 'privateKeyPassphrase' in defaultValues ? defaultValues.privateKeyPassphrase : undefined,
    })
    authMetadata = {
      authMethod: SnowflakeAuthMethods.ServiceAccountKeyPair,
      username,
      privateKey,
      ...(privateKeyPassphrase ? { privateKeyPassphrase } : {}),
    }
  }

  const warehouse = await promptForOptionalStringField({
    label: 'Warehouse:',
    defaultValue: defaultValues?.warehouse,
  })
  const database = await promptForOptionalStringField({
    label: 'Database:',
    defaultValue: defaultValues?.database,
  })
  const role = await promptForOptionalStringField({
    label: 'Role:',
    defaultValue: defaultValues?.role,
  })

  const metadata = {
    accountName,
    ...authMetadata,
    ...(warehouse ? { warehouse } : {}),
    ...(database ? { database } : {}),
    ...(role ? { role } : {}),
  } as DatabaseIntegrationMetadataByType['snowflake']

  return {
    id,
    type,
    name,
    metadata,
  }
}
