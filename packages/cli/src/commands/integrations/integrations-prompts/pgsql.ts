import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'
import { promptForSshFields } from './prompt-for-ssh-fields'
import { promptForSslFields } from './prompt-for-ssl-fields'

export async function promptForFieldsPostgres({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'pgsql'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['pgsql']
}): Promise<DatabaseIntegrationConfig> {
  const host = await promptForRequiredStringField({ label: 'Host:', defaultValue: defaultValues?.host })
  const port = await promptForRequiredStringPortField({
    label: 'Port:',
    defaultValue: defaultValues?.port ?? '5432',
  })
  const database = await promptForRequiredStringField({ label: 'Database:', defaultValue: defaultValues?.database })
  const user = await promptForRequiredStringField({ label: 'User:', defaultValue: defaultValues?.user })
  const password = await promptForRequiredSecretField({ label: 'Password:', defaultValue: defaultValues?.password })

  let metadata: DatabaseIntegrationMetadataByType['pgsql'] = {
    host,
    port,
    database,
    user,
    password,
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
