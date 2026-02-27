import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'
import { promptForSshFields } from './prompt-for-ssh-fields'
import { promptForSslFields } from './prompt-for-ssl-fields'

export async function promptForFieldsMindsdb({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'mindsdb'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['mindsdb']
}): Promise<DatabaseIntegrationConfig> {
  const host = await promptForRequiredStringField({ label: 'Host:', defaultValue: defaultValues?.host })
  const port = await promptForRequiredStringPortField({
    label: 'Port:',
    defaultValue: defaultValues?.port ?? '47334',
  })
  const database = await promptForRequiredStringField({ label: 'Database:', defaultValue: defaultValues?.database })
  const user = await promptForRequiredStringField({ label: 'User:', defaultValue: defaultValues?.user })
  const password = await promptForRequiredSecretField({ label: 'Password:', defaultValue: defaultValues?.password })

  let metadata: DatabaseIntegrationMetadataByType['mindsdb'] = {
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
