import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForOptionalBooleanField,
  promptForOptionalSecretField,
  promptForOptionalStringField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'

export function buildMongoConnectionString({
  host,
  port,
  user,
  password,
  database,
}: {
  host: string
  port: string
  user: string
  password: string
  database: string
}): string {
  const credentials = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
  const db = database ? `/${database}` : ''
  return `mongodb://${credentials}@${host}:${port}${db}`
}

export function parseMongoConnectionString(connectionString: string): {
  host?: string
  port?: string
  user?: string
  password?: string
  database?: string
} {
  try {
    const url = new URL(connectionString)
    return {
      host: url.hostname || undefined,
      port: url.port || undefined,
      user: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      database: url.pathname.slice(1) || undefined,
    }
  } catch {
    return {}
  }
}

export async function promptForFieldsMongodb({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'mongodb'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['mongodb']
}): Promise<DatabaseIntegrationConfig> {
  // When editing, parse the connection string to extract defaults for individual fields
  const parsed = defaultValues?.connection_string ? parseMongoConnectionString(defaultValues.connection_string) : {}

  const host = await promptForRequiredStringField({ label: 'Host:', defaultValue: parsed.host })
  const port = await promptForRequiredStringPortField({
    label: 'Port:',
    defaultValue: parsed.port ?? '27017',
  })
  const database = await promptForRequiredStringField({ label: 'Database:', defaultValue: parsed.database })
  const user = await promptForRequiredStringField({ label: 'User:', defaultValue: parsed.user })
  const password = await promptForRequiredSecretField({ label: 'Password:', defaultValue: parsed.password })

  const connection_string = buildMongoConnectionString({ host, port, user, password, database })

  // Only store connection_string in metadata — no individual fields to avoid inconsistency
  let metadata: DatabaseIntegrationMetadataByType['mongodb'] = {
    connection_string,
  }

  const sshEnabled = await promptForOptionalBooleanField({
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

  const sslEnabled = await promptForOptionalBooleanField({
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
