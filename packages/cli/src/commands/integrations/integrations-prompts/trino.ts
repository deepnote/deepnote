import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import { TrinoAuthMethods } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import {
  promptForOptionalStringPortField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
} from '../../../utils/inquirer'
import { assertNever } from '../../../utils/typescript'
import { promptForSshFields } from './prompt-for-ssh-fields'
import { promptForSslFields } from './prompt-for-ssl-fields'

type TrinoMetadata = DatabaseIntegrationMetadataByType['trino']

/** Password branch allows `authMethod: null` (see zod schema); discriminate by fields instead of optional authMethod. */
type TrinoPasswordMetadata = Extract<TrinoMetadata, { user: string; password: string }>
type TrinoOauthMetadata = Extract<TrinoMetadata, { authMethod: typeof TrinoAuthMethods.Oauth }>

function isMatchingDefaultValues<T extends TrinoMetadata>(
  defaultValues: TrinoMetadata | undefined,
  authMethod: T['authMethod']
): defaultValues is T {
  if (!defaultValues) {
    return false
  }
  const currentMethod = defaultValues.authMethod ?? TrinoAuthMethods.Password
  return currentMethod === authMethod
}

interface TrinoPasswordAuth {
  authMethod: typeof TrinoAuthMethods.Password
  user: string
  password: string
}
interface TrinoOauthAuth {
  authMethod: typeof TrinoAuthMethods.Oauth
  clientId: string
  clientSecret: string
  authUrl: string
  tokenUrl: string
}

type TrinoAuthFieldsUnion = TrinoPasswordAuth | TrinoOauthAuth

async function promptForPasswordAuth(defaultValues?: TrinoPasswordMetadata): Promise<TrinoPasswordAuth> {
  const user = await promptForRequiredStringField({
    label: 'User:',
    defaultValue: defaultValues?.user,
  })
  const password = await promptForRequiredSecretField({
    label: 'Password:',
    defaultValue: defaultValues?.password,
  })

  return {
    authMethod: TrinoAuthMethods.Password,
    user,
    password,
  }
}

async function promptForOauthAuth(defaultValues?: TrinoOauthMetadata): Promise<TrinoOauthAuth> {
  const clientId = await promptForRequiredStringField({
    label: 'Client ID:',
    defaultValue: defaultValues?.clientId,
  })
  const clientSecret = await promptForRequiredSecretField({
    label: 'Client Secret:',
    defaultValue: defaultValues?.clientSecret,
  })
  const authUrl = await promptForRequiredStringField({
    label: 'Authorization URL:',
    defaultValue: defaultValues?.authUrl,
  })
  const tokenUrl = await promptForRequiredStringField({
    label: 'Token URL:',
    defaultValue: defaultValues?.tokenUrl,
  })

  return {
    authMethod: TrinoAuthMethods.Oauth,
    clientId,
    clientSecret,
    authUrl,
    tokenUrl,
  }
}

async function promptForAuthFields(
  authMethod: typeof TrinoAuthMethods.Password | typeof TrinoAuthMethods.Oauth,
  defaultValues?: TrinoMetadata
): Promise<TrinoAuthFieldsUnion> {
  switch (authMethod) {
    case TrinoAuthMethods.Password:
      return promptForPasswordAuth(
        isMatchingDefaultValues<TrinoPasswordMetadata>(defaultValues, authMethod) ? defaultValues : undefined
      )
    case TrinoAuthMethods.Oauth:
      return promptForOauthAuth(
        isMatchingDefaultValues<TrinoOauthMetadata>(defaultValues, authMethod) ? defaultValues : undefined
      )
    default:
      return assertNever(authMethod)
  }
}

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

  const authMetadata = await promptForAuthFields(authMethod, defaultValues)

  let metadata: TrinoMetadata = {
    host,
    port,
    database,
    ...authMetadata,
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
