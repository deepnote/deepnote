import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import { AwsAuthMethods, DatabaseAuthMethods } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import {
  promptForOptionalStringPortField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
} from '../../../utils/inquirer'
import { promptForSshFields } from './prompt-for-ssh-fields'
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
