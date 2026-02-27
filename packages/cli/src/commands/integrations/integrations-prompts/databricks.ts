import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForOptionalStringField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'
import { promptForSshFields } from './prompt-for-ssh-fields'

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

  const sshFields = await promptForSshFields(defaultValues)
  metadata = { ...metadata, ...sshFields }

  return {
    id,
    type,
    name,
    metadata,
  }
}
