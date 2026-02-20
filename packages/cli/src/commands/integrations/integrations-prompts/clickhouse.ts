import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForBooleanField,
  promptForOptionalSecretField,
  promptForOptionalStringField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'

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

  const sslEnabled = await promptForBooleanField({
    label: 'Enable SSL:',
    defaultValue: defaultValues?.sslEnabled ?? false,
  })
  if (sslEnabled === true) {
    const caCertificateName = await promptForOptionalStringField({
      label: 'CA Certificate Name:',
      defaultValue: defaultValues?.caCertificateName,
    })
    const caCertificateText = await promptForOptionalSecretField({
      label: 'CA Certificate:',
      defaultValue: defaultValues?.caCertificateText,
    })

    metadata = {
      ...metadata,
      sslEnabled: true,
      caCertificateName,
      caCertificateText,
    }
  }

  return {
    id,
    type,
    name,
    metadata,
  }
}
