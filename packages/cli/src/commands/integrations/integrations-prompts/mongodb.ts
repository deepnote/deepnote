import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import {
  promptForBooleanField,
  promptForOptionalSecretField,
  promptForOptionalStringField,
  promptForOptionalStringPortField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'

export const MONGO_PREFIX = 'mongodb://'
export const SRV_PREFIX = 'mongodb+srv://'

export function safeUrlParse(url: string): URL | null {
  try {
    return new URL(url)
  } catch (error) {
    if (error instanceof ReferenceError) {
      return null
    }
    throw error
  }
}

export function encodeOptions(options: string): string {
  return options.replace(/,|\n/g, '&').replace(/\s/g, '')
}

export function encodeConnectionString(connectionString: string): string {
  // Matches: <protocol://><username>[:<password>]@<rest>
  const match = connectionString.match(/^(.*?\/\/)([^:@]+)(?::([^@]*))?@(.*)$/)
  if (!match) {
    return connectionString
  }
  const [, protocol, username, password, rest] = match
  const encodedUsername = encodeURIComponent(username)
  const credentials = password !== undefined ? `${encodedUsername}:${encodeURIComponent(password)}` : encodedUsername
  return `${protocol}${credentials}@${rest}`
}

export function buildMongoConnectionString({
  prefix,
  host,
  port,
  user,
  password,
  database,
  options,
}: {
  prefix: string
  host: string
  port?: string
  user?: string
  password?: string
  database?: string
  options?: string
}): string {
  let credentials = ''
  let portPart = ''
  let dbPart = ''
  let optionsPart = ''

  if (user) {
    credentials = password
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
      : `${encodeURIComponent(user)}@`
  }
  if (port) {
    portPart = `:${port}`
  }
  if (database) {
    dbPart = `/${database}`
  }
  if (options) {
    optionsPart = `?${encodeOptions(options)}`
  }

  return `${prefix}${credentials}${host}${portPart}${dbPart}${optionsPart}`
}

export function parseMongoConnectionString(connectionString: string): {
  prefix: string
  host?: string
  port?: string
  user?: string
  password?: string
  database?: string
} | null {
  const url = safeUrlParse(connectionString)
  if (url == null) {
    return null
  }

  const prefix = url.protocol === 'mongodb+srv:' ? SRV_PREFIX : MONGO_PREFIX

  return {
    prefix,
    host: url.hostname || undefined,
    port: url.port || undefined,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database: url.pathname.slice(1) || undefined,
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
  const defaultConnectionType: 'credentials' | 'connection_string' = defaultValues?.rawConnectionString
    ? 'connection_string'
    : 'credentials'

  const connectionType = await select<'credentials' | 'connection_string'>({
    message: 'Connection type:',
    choices: [
      { name: 'Credentials (host, user, password)', value: 'credentials' },
      { name: 'Connection string', value: 'connection_string' },
    ],
    default: defaultConnectionType,
  })

  let metadata: DatabaseIntegrationMetadataByType['mongodb']

  if (connectionType === 'credentials') {
    const parsedFromConnectionString = defaultValues?.connection_string
      ? parseMongoConnectionString(defaultValues.connection_string)
      : null

    const prefix = await select<string>({
      message: 'Prefix:',
      choices: [
        { name: MONGO_PREFIX, value: MONGO_PREFIX },
        { name: SRV_PREFIX, value: SRV_PREFIX },
      ],
      default: defaultValues?.prefix ?? parsedFromConnectionString?.prefix ?? MONGO_PREFIX,
    })

    const host = await promptForRequiredStringField({
      label: 'Host:',
      defaultValue: defaultValues?.host ?? parsedFromConnectionString?.host,
    })

    const portRaw = await promptForOptionalStringPortField({
      label: 'Port:',
      defaultValue: defaultValues?.port ?? parsedFromConnectionString?.port ?? '27017',
    })

    const userRaw = await promptForOptionalStringField({
      label: 'User:',
      defaultValue: defaultValues?.user ?? parsedFromConnectionString?.user,
    })

    const passwordRaw = await promptForOptionalSecretField({
      label: 'Password:',
      defaultValue: defaultValues?.password ?? parsedFromConnectionString?.password,
    })

    const databaseRaw = await promptForOptionalStringField({
      label: 'Database:',
      defaultValue: defaultValues?.database ?? parsedFromConnectionString?.database,
    })

    const optionsRaw = await promptForOptionalStringField({
      label: 'Options:',
      defaultValue: defaultValues?.options,
    })

    const port = portRaw || undefined
    const user = userRaw || undefined
    const password = passwordRaw || undefined
    const database = databaseRaw || undefined
    const options = optionsRaw || undefined

    const connection_string = buildMongoConnectionString({ prefix, host, port, user, password, database, options })

    metadata = {
      prefix,
      host,
      ...(port !== undefined ? { port } : {}),
      ...(user !== undefined ? { user } : {}),
      ...(password !== undefined ? { password } : {}),
      ...(database !== undefined ? { database } : {}),
      ...(options !== undefined ? { options } : {}),
      connection_string,
    }
  } else {
    const rawConnectionString = await promptForRequiredSecretField({
      label: 'Connection string:',
      defaultValue: defaultValues?.rawConnectionString,
    })

    const connection_string = encodeConnectionString(rawConnectionString)

    metadata = {
      rawConnectionString,
      connection_string,
    }
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
