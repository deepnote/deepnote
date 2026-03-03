import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForOptionalSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'
import { promptForSshFields } from './prompt-for-ssh-fields'
import { promptForSslFields } from './prompt-for-ssl-fields'

export async function promptForFieldsClickhouse({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'clickhouse'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['clickhouse']
}): Promise<DatabaseIntegrationConfig> {
  const host = await promptForRequiredStringField({ label: 'Host:', defaultValue: defaultValues?.host })
  const port = await promptForRequiredStringPortField({
    label: 'Port:',
    defaultValue: defaultValues?.port ?? '443',
  })
  const database = await promptForRequiredStringField({ label: 'Database:', defaultValue: defaultValues?.database })
  const user = await promptForRequiredStringField({ label: 'User:', defaultValue: defaultValues?.user })
  const password = await promptForOptionalSecretField({ label: 'Password:', defaultValue: defaultValues?.password })

  let metadata: DatabaseIntegrationMetadataByType['clickhouse'] = {
    host,
    port,
    database,
    user,
    ...(password ? { password } : {}),
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
