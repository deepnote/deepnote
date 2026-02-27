import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import { TrinoAuthMethods } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import {
  promptForBooleanField,
  promptForOptionalStringPortField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'
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

  const sshEnabled = await promptForBooleanField({
    label: 'Enable SSH tunnel:',
    defaultValue: defaultValues?.sshEnabled ?? false,
  })
  if (sshEnabled === true) {
    const sshHost = await promptForRequiredStringField({ label: 'SSH Host:', defaultValue: defaultValues?.sshHost })
    const sshPort = await promptForRequiredStringPortField({
      label: 'SSH Port:',
      defaultValue: defaultValues?.sshPort ?? '22',
    })
    const sshUser = await promptForRequiredStringField({ label: 'SSH User:', defaultValue: defaultValues?.sshUser })

    metadata = {
      ...metadata,
      sshEnabled: true,
      sshHost,
      sshPort,
      sshUser,
    }
  }

  const sslFields = await promptForSslFields(defaultValues)
  metadata = { ...metadata, ...sslFields }

  return {
    id,
    type,
    name,
    metadata,
  }
}
