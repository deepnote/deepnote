import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import { TrinoAuthMethods } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import {
  promptForOptionalStringPortField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
} from '../../../utils/inquirer'
import { promptForSshFields } from './prompt-for-ssh-fields'
import { promptForSslFields } from './prompt-for-ssl-fields'

export async function promptForFieldsTrino({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'trino'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['trino']
}): Promise<DatabaseIntegrationConfig> {
  const host = await promptForRequiredStringField({ label: 'Host:', defaultValue: defaultValues?.host })
  const port = await promptForOptionalStringPortField({
    label: 'Port:',
    defaultValue: defaultValues?.port ?? '443',
  })
  const database = await promptForRequiredStringField({ label: 'Database:', defaultValue: defaultValues?.database })

  const currentAuthMethod =
    defaultValues && 'authMethod' in defaultValues && defaultValues.authMethod
      ? defaultValues.authMethod
      : TrinoAuthMethods.Password

  const authMethod = await select({
    message: 'Authentication method:',
    default: currentAuthMethod,
    choices: [
      { name: 'Username and Password', value: TrinoAuthMethods.Password },
      { name: 'OAuth 2.0', value: TrinoAuthMethods.Oauth },
    ],
  })

  let metadata: DatabaseIntegrationMetadataByType['trino']

  if (authMethod === TrinoAuthMethods.Password) {
    const user = await promptForRequiredStringField({
      label: 'User:',
      defaultValue: defaultValues && 'user' in defaultValues ? defaultValues.user : undefined,
    })
    const password = await promptForRequiredSecretField({
      label: 'Password:',
      defaultValue: defaultValues && 'password' in defaultValues ? defaultValues.password : undefined,
    })

    metadata = {
      authMethod: TrinoAuthMethods.Password,
      host,
      port,
      database,
      user,
      password,
    }
  } else {
    const clientId = await promptForRequiredStringField({
      label: 'Client ID:',
      defaultValue: defaultValues && 'clientId' in defaultValues ? defaultValues.clientId : undefined,
    })
    const clientSecret = await promptForRequiredSecretField({
      label: 'Client Secret:',
      defaultValue: defaultValues && 'clientSecret' in defaultValues ? defaultValues.clientSecret : undefined,
    })
    const authUrl = await promptForRequiredStringField({
      label: 'Authorization URL:',
      defaultValue: defaultValues && 'authUrl' in defaultValues ? defaultValues.authUrl : undefined,
    })
    const tokenUrl = await promptForRequiredStringField({
      label: 'Token URL:',
      defaultValue: defaultValues && 'tokenUrl' in defaultValues ? defaultValues.tokenUrl : undefined,
    })

    metadata = {
      authMethod: TrinoAuthMethods.Oauth,
      host,
      port,
      database,
      clientId,
      clientSecret,
      authUrl,
      tokenUrl,
    }
  }

  const sshFields = await promptForSshFields(defaultValues)
  metadata = { ...metadata, ...sshFields }

  const sslFields = await promptForSslFields(defaultValues)
  metadata = { ...metadata, ...sslFields }

  return {
    id,
    type,
    name,
    metadata,
  }
}
