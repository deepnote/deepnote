import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForBooleanField,
  promptForOptionalStringField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'

export async function promptForFieldsDatabricks({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'databricks'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['databricks']
}): Promise<DatabaseIntegrationConfig> {
  const host = await promptForRequiredStringField({ label: 'Host:', defaultValue: defaultValues?.host })
  const port = await promptForRequiredStringPortField({
    label: 'Port:',
    defaultValue: defaultValues?.port ?? '443',
  })
  const httpPath = await promptForRequiredStringField({ label: 'HTTP Path:', defaultValue: defaultValues?.httpPath })
  const token = await promptForRequiredSecretField({ label: 'Token:', defaultValue: defaultValues?.token })
  const schema = await promptForOptionalStringField({ label: 'Schema:', defaultValue: defaultValues?.schema })
  const catalog = await promptForOptionalStringField({ label: 'Catalog:', defaultValue: defaultValues?.catalog })

  let metadata: DatabaseIntegrationMetadataByType['databricks'] = {
    host,
    port,
    httpPath,
    token,
    ...(schema ? { schema } : {}),
    ...(catalog ? { catalog } : {}),
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
