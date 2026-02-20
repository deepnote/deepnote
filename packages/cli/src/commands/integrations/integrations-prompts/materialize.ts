import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForBooleanField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'

export async function promptForFieldsMaterialize({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'materialize'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['materialize']
}): Promise<DatabaseIntegrationConfig> {
  const host = await promptForRequiredStringField({ label: 'Host:', defaultValue: defaultValues?.host })
  const port = await promptForRequiredStringPortField({
    label: 'Port:',
    defaultValue: defaultValues?.port ?? '6875',
  })
  const database = await promptForRequiredStringField({ label: 'Database:', defaultValue: defaultValues?.database })
  const user = await promptForRequiredStringField({ label: 'User:', defaultValue: defaultValues?.user })
  const password = await promptForRequiredSecretField({ label: 'Password:', defaultValue: defaultValues?.password })
  const cluster = await promptForRequiredStringField({
    label: 'Cluster:',
    defaultValue: defaultValues?.cluster ?? 'default',
  })

  let metadata: DatabaseIntegrationMetadataByType['materialize'] = {
    host,
    port,
    database,
    user,
    password,
    cluster,
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
