import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import { AwsAuthMethods, DatabaseAuthMethods } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import {
  promptForOptionalStringPortField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
} from '../../../utils/inquirer'
import { assertNever } from '../../../utils/typescript'
import { promptForSshFields } from './prompt-for-ssh-fields'
import { promptForSslFields } from './prompt-for-ssl-fields'

type RedshiftMetadata = DatabaseIntegrationMetadataByType['redshift']

type RedshiftPasswordMetadata = Extract<
  RedshiftMetadata,
  { authMethod?: typeof DatabaseAuthMethods.UsernameAndPassword }
>
type RedshiftIamRoleMetadata = Extract<RedshiftMetadata, { authMethod: typeof AwsAuthMethods.IamRole }>

function isMatchingDefaultValues<T extends RedshiftMetadata>(
  defaultValues: RedshiftMetadata | undefined,
  authMethod: T['authMethod']
): defaultValues is T {
  if (!defaultValues) {
    return false
  }
  const currentMethod = defaultValues.authMethod ?? DatabaseAuthMethods.UsernameAndPassword
  return currentMethod === authMethod
}

interface RedshiftPasswordAuth {
  authMethod: typeof DatabaseAuthMethods.UsernameAndPassword
  user: string
  password: string
}
interface RedshiftIamRoleAuth {
  authMethod: typeof AwsAuthMethods.IamRole
  roleArn: string
  roleExternalId: string
  roleNonce: string
}
interface RedshiftIndividualCredentialsAuth {
  authMethod: typeof DatabaseAuthMethods.IndividualCredentials
}

type RedshiftAuthFieldsUnion = RedshiftPasswordAuth | RedshiftIamRoleAuth | RedshiftIndividualCredentialsAuth

async function promptForPasswordAuth(defaultValues?: RedshiftPasswordMetadata): Promise<RedshiftPasswordAuth> {
  const user = await promptForRequiredStringField({
    label: 'User:',
    defaultValue: defaultValues?.user,
  })
  const password = await promptForRequiredSecretField({
    label: 'Password:',
    defaultValue: defaultValues?.password,
  })

  return {
    authMethod: DatabaseAuthMethods.UsernameAndPassword,
    user,
    password,
  }
}

async function promptForIamRoleAuth(defaultValues?: RedshiftIamRoleMetadata): Promise<RedshiftIamRoleAuth> {
  const roleArn = await promptForRequiredStringField({
    label: 'Role ARN:',
    defaultValue: defaultValues?.roleArn,
  })
  const roleExternalId = await promptForRequiredStringField({
    label: 'External ID:',
    defaultValue: defaultValues?.roleExternalId,
  })
  const roleNonce = await promptForRequiredStringField({
    label: 'Nonce:',
    defaultValue: defaultValues?.roleNonce,
  })

  return {
    authMethod: AwsAuthMethods.IamRole,
    roleArn,
    roleExternalId,
    roleNonce,
  }
}

async function promptForAuthFields(
  authMethod:
    | typeof DatabaseAuthMethods.UsernameAndPassword
    | typeof AwsAuthMethods.IamRole
    | typeof DatabaseAuthMethods.IndividualCredentials,
  defaultValues?: RedshiftMetadata
): Promise<RedshiftAuthFieldsUnion> {
  switch (authMethod) {
    case DatabaseAuthMethods.UsernameAndPassword:
      return promptForPasswordAuth(
        isMatchingDefaultValues<RedshiftPasswordMetadata>(defaultValues, authMethod) ? defaultValues : undefined
      )
    case AwsAuthMethods.IamRole:
      return promptForIamRoleAuth(
        isMatchingDefaultValues<RedshiftIamRoleMetadata>(defaultValues, authMethod) ? defaultValues : undefined
      )
    case DatabaseAuthMethods.IndividualCredentials:
      return {
        authMethod: DatabaseAuthMethods.IndividualCredentials,
      }
    default:
      return assertNever(authMethod)
  }
}

export async function promptForFieldsRedshift({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'redshift'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['redshift']
}): Promise<DatabaseIntegrationConfig> {
  const host = await promptForRequiredStringField({ label: 'Host:', defaultValue: defaultValues?.host })
  const port = await promptForOptionalStringPortField({
    label: 'Port:',
    defaultValue: defaultValues?.port ?? '5439',
  })
  const database = await promptForRequiredStringField({ label: 'Database:', defaultValue: defaultValues?.database })

  const currentAuthMethod =
    defaultValues && 'authMethod' in defaultValues && defaultValues.authMethod
      ? defaultValues.authMethod
      : DatabaseAuthMethods.UsernameAndPassword

  const authMethod = await select({
    message: 'Authentication method:',
    default: currentAuthMethod,
    choices: [
      { name: 'Username and Password', value: DatabaseAuthMethods.UsernameAndPassword },
      { name: 'IAM Role', value: AwsAuthMethods.IamRole },
      { name: 'Individual Credentials', value: DatabaseAuthMethods.IndividualCredentials },
    ],
  })

  const authMetadata = await promptForAuthFields(authMethod, defaultValues)

  let metadata: RedshiftMetadata = {
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
