import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'
import { promptForSshFields } from './prompt-for-ssh-fields'

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

  const sshFields = await promptForSshFields(defaultValues)
  metadata = { ...metadata, ...sshFields }

  return {
    id,
    type,
    name,
    metadata,
  }
}
