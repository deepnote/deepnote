import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForBooleanField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'

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

  return {
    id,
    type,
    name,
    metadata,
  }
}
