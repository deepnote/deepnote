import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'
import { promptForSshFields } from './prompt-for-ssh-fields'

export async function promptForFieldsDremio({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'dremio'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['dremio']
}): Promise<DatabaseIntegrationConfig> {
  const host = await promptForRequiredStringField({ label: 'Host:', defaultValue: defaultValues?.host })
  const port = await promptForRequiredStringPortField({
    label: 'Port:',
    defaultValue: defaultValues?.port ?? '443',
  })
  const schema = await promptForRequiredStringField({ label: 'Schema:', defaultValue: defaultValues?.schema })
  const token = await promptForRequiredSecretField({ label: 'Token:', defaultValue: defaultValues?.token })

  let metadata: DatabaseIntegrationMetadataByType['dremio'] = {
    host,
    port,
    schema,
    token,
  }

  const sshFields = await promptForSshFields(defaultValues)
  metadata = { ...metadata, ...sshFields }

  return {
    id,
    type,
    name,
    metadata,
  }
}
