import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import { AwsAuthMethods, DatabaseAuthMethods } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import {
  promptForBooleanField,
  promptForOptionalStringPortField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'
import { promptForSslFields } from './prompt-for-ssl-fields'

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

  let metadata: DatabaseIntegrationMetadataByType['redshift']

  if (authMethod === DatabaseAuthMethods.UsernameAndPassword) {
    const user = await promptForRequiredStringField({
      label: 'User:',
      defaultValue: defaultValues && 'user' in defaultValues ? defaultValues.user : undefined,
    })
    const password = await promptForRequiredSecretField({
      label: 'Password:',
      defaultValue: defaultValues && 'password' in defaultValues ? defaultValues.password : undefined,
    })

    metadata = {
      authMethod: DatabaseAuthMethods.UsernameAndPassword,
      host,
      port,
      database,
      user,
      password,
    }
  } else if (authMethod === AwsAuthMethods.IamRole) {
    const roleArn = await promptForRequiredStringField({
      label: 'Role ARN:',
      defaultValue: defaultValues && 'roleArn' in defaultValues ? defaultValues.roleArn : undefined,
    })
    const roleExternalId = await promptForRequiredStringField({
      label: 'External ID:',
      defaultValue: defaultValues && 'roleExternalId' in defaultValues ? defaultValues.roleExternalId : undefined,
    })
    const roleNonce = await promptForRequiredStringField({
      label: 'Nonce:',
      defaultValue: defaultValues && 'roleNonce' in defaultValues ? defaultValues.roleNonce : undefined,
    })

    metadata = {
      authMethod: AwsAuthMethods.IamRole,
      host,
      port,
      database,
      roleArn,
      roleExternalId,
      roleNonce,
    }
  } else {
    metadata = {
      authMethod: DatabaseAuthMethods.IndividualCredentials,
      host,
      port,
      database,
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
