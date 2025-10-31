import { assertNever } from 'zod/v4/core/util.cjs'
import type { DatabaseIntegrationMetadataByType } from './database-integration-metadata-schemas'
import type { DatabaseIntegrationType, SqlIntegrationType } from './database-integration-types'
import { getSnowflakeSqlAlchemyInput } from './snowflake-integration-env-vars'
import type { SqlAlchemyInput } from './sql-alchemy-types'
import {
  AwsAuthMethods,
  type FederatedAuthMethod,
  isFederatedAuthMetadata,
  isFederatedAuthMethod,
} from './sql-integration-auth-methods'

export interface EnvVar {
  name: string
  value: string
}

export type DatabaseIntegrationConfig = {
  [integrationType in DatabaseIntegrationType]: {
    type: integrationType
    id: string
    name: string
    metadata: DatabaseIntegrationMetadataByType[integrationType]
    federated_auth_method?: FederatedAuthMethod
  }
}[DatabaseIntegrationType]

export type SqlIntegrationConfig = Extract<DatabaseIntegrationConfig, { type: SqlIntegrationType }>

export function getIntegrationListEnv(
  sqlIntegrations: Array<DatabaseIntegrationConfig>,
  params: {
    projectRootDirectory: string
    snowflakePartnerIdentifier?: string
  }
): {
  envVars: Array<EnvVar>
  errors: Array<Error>
} {
  const envVars: Array<EnvVar> = []
  const errors: Array<Error> = []

  sqlIntegrations.forEach(integration => {
    const namePrefix = convertToEnvironmentVariableName(integration.name)

    const envVarsForThisIntegration: Array<EnvVar> = Object.entries(integration.metadata).map(([key, rawValue]) => {
      const name = `${namePrefix}_${key.toUpperCase()}`
      const value = String(rawValue) // converts booleans to "true" or "false"

      // For MongoDB, we need to inject the SSL options into the connection string.
      if (integration.type === 'mongodb' && integration.metadata.sslEnabled && key === 'connection_string') {
        return {
          name,
          value: addSslOptionsToMongoConnectionString(
            params.projectRootDirectory,
            value,
            integration.id,
            integration.metadata
          ),
        }
      }

      return {
        name,
        value: value,
      }
    })

    // NOTE: MongoDB is not a SQL integration, we only set the normal integration env variables without the SQL alchemy config.
    if (integration.type !== 'mongodb') {
      try {
        const envVar = getEnvVarForSqlCells(integration, params)
        if (envVar) {
          envVarsForThisIntegration.push(envVar)
        }
      } catch (error) {
        errors.push(error as Error)
      }
    }

    envVars.push(...envVarsForThisIntegration.filter(envVar => !!envVar.name))
  })

  return { envVars, errors }
}

const duckDbEnvVar: SqlAlchemyInput = {
  url: `deepnote+duckdb:///:memory:`,
  params: {},
  param_style: 'qmark',
}

function addSslOptionsToMongoConnectionString(
  projectRoot: string,
  connectionString: string,
  integrationId: string,
  metadata: DatabaseIntegrationMetadataByType['mongodb']
): string {
  const [base, paramString] = connectionString.split('?')

  const params = new URLSearchParams(paramString)

  params.set('tls', 'true')

  if (metadata.caCertificateName) {
    const path = getCACertificatePath({
      projectRoot,
      integrationId,
      caCertificateName: metadata.caCertificateName,
    })

    params.set('tlsCAFile', path)
  }

  return `${base}?${params.toString()}`
}

function getEnvVarForSqlCells(
  integration: SqlIntegrationConfig,
  params: {
    projectRootDirectory: string
    snowflakePartnerIdentifier?: string
  }
): EnvVar | null {
  const sqlAlchemyInput = getSqlAlchemyInput(integration, params)
  if (!sqlAlchemyInput) {
    return null
  }

  return {
    name: convertToEnvironmentVariableName(getSqlEnvVarName(integration.id)),
    value: JSON.stringify({ integration_id: integration.id, ...sqlAlchemyInput }),
  }
}

/**
 * @returns sql alchemy input, or undefined if there is an error.
 *
 * The URL and the params are passed to SQL Alchemy's create_engine function as arguments. The params are
 * passed as keyword arguments to the function.
 * https://docs.sqlalchemy.org/en/20/core/engines.html#sqlalchemy.create_engine
 *
 * See the `query_data_source` method in Deepnote Toolkit for more details:
 * https://github.com/deepnote/deepnote-toolkit/blob/main/deepnote_toolkit/sql/sql_execution.py#L321
 */
export function getSqlAlchemyInput(
  integration: SqlIntegrationConfig,
  params: {
    projectRootDirectory: string
    snowflakePartnerIdentifier?: string
  }
): SqlAlchemyInput | null {
  if (integration.federated_auth_method) {
    return null
  }

  switch (integration.type) {
    case 'alloydb':
    case 'pgsql':
      return getPostgresSqlAlchemyInput(integration.id, params.projectRootDirectory, integration.metadata)

    case 'athena':
      return getAthenaSqlAlchemyInput(integration.metadata)

    case 'big-query':
      return getBigQuerySqlAlchemyInput(integration.metadata)

    case 'clickhouse':
      return getClickHouseSqlAlchemyInput(integration.id, params.projectRootDirectory, integration.metadata)

    case 'databricks':
      return getDatabricksSqlAlchemyInput(integration.metadata)

    case 'dremio':
      return getDremioSqlAlchemyInput(integration.metadata)

    case 'mariadb':
    case 'mindsdb':
    case 'mysql':
      return getMySqlSqlAlchemyInput(integration.id, params.projectRootDirectory, integration.metadata)

    case 'materialize':
      return getMaterializePostgresSqlAlchemyInput(integration.id, params.projectRootDirectory, integration.metadata)

    case 'pandas-dataframe':
      return { ...duckDbEnvVar }

    case 'redshift':
      return getRedshiftSqlAlchemyInput(integration.id, params.projectRootDirectory, integration.metadata)

    case 'snowflake':
      return getSnowflakeSqlAlchemyInput(integration.metadata, {
        snowflakePartnerIdentifier: params.snowflakePartnerIdentifier,
      })

    case 'spanner':
      return getSpannerSqlAlchemyInput(integration.metadata)

    case 'sql-server':
      return getSQLServerVar(integration.metadata)

    case 'trino':
      return getTrinoEnvVars(integration.id, integration.metadata, params.projectRootDirectory)

    default:
      assertNever(integration)
  }
}

const getDatabricksSqlAlchemyInput = ({
  httpPath,
  host,
  token,
  port,
  schema,
  catalog,
  sshEnabled,
  sshHost,
  sshPort,
  sshUser,
}: DatabaseIntegrationMetadataByType['databricks']): SqlAlchemyInput => {
  return {
    url: `databricks+connector://token:${token}@${host}:${port}`,
    params: {
      connect_args: {
        http_path: httpPath,
        schema,
        catalog,
      },
    },
    param_style: 'pyformat',
    ssh_options: {
      enabled: String(sshEnabled),
      host: sshHost,
      port: sshPort,
      user: sshUser,
    },
  }
}

const getDremioSqlAlchemyInput = ({
  port,
  host,
  token,
  schema,
  sshEnabled,
  sshHost,
  sshPort,
  sshUser,
}: DatabaseIntegrationMetadataByType['dremio']): SqlAlchemyInput => {
  const url = new URL(`dremio+flight://${host}:${port}${schema ? '/' + schema : ''}`)
  // Always true.
  url.searchParams.set('UseEncryption', 'true')
  url.searchParams.set('Token', token)

  return {
    url: url.href,
    params: {},
    param_style: 'pyformat',
    ssh_options: {
      enabled: String(sshEnabled),
      host: sshHost,
      port: sshPort,
      user: sshUser,
    },
  }
}

const getSQLServerVar = ({
  user,
  password,
  host,
  port,
  database,
  sshEnabled,
  sshHost,
  sshPort,
  sshUser,
}: DatabaseIntegrationMetadataByType['sql-server']): SqlAlchemyInput => {
  const portSuffix = port ? `:${port}` : ''
  return {
    url: `mssql+pymssql://${user}:${encodeURIComponent(password)}@${host}${portSuffix}/${database}`,
    params: {},
    param_style: 'pyformat',
    ssh_options: {
      enabled: String(sshEnabled),
      host: sshHost,
      port: sshPort,
      user: sshUser,
    },
  }
}

const getPostgresSqlAlchemyInput = (
  integrationId: string,
  projectRootDirectory: string,
  {
    user,
    password,
    host,
    port,
    database,
    sshEnabled,
    sshHost,
    sshPort,
    sshUser,
    sslEnabled,
    caCertificateName,
  }: DatabaseIntegrationMetadataByType['pgsql']
): SqlAlchemyInput => {
  const portSuffix = port ? `:${port}` : ''
  const mode = getPostgresStyleMode(caCertificateName, sslEnabled)

  return {
    url: `postgresql://${user}:${encodeURIComponent(password)}@${host}${portSuffix}/${database}`,
    params: {
      connect_args: {
        // these should ensure the postgres connection is kept alive https://stackoverflow.com/a/56325038/2761695
        keepalives: 1,
        keepalives_idle: 30,
        keepalives_interval: 10,
        keepalives_count: 5,

        sslmode: mode,
        sslrootcert: caCertificateName
          ? getCACertificatePath({
              projectRoot: projectRootDirectory,
              integrationId,
              caCertificateName,
            })
          : undefined,
      },
    },
    param_style: 'pyformat',
    ssh_options: {
      enabled: String(sshEnabled),
      host: sshHost,
      port: sshPort,
      user: sshUser,
    },
  }
}

export const getRedshiftSqlAlchemyInput = (
  integrationId: string,
  projectRootDirectory: string,
  {
    user,
    password,
    host,
    port,
    database,
    sshEnabled,
    sshHost,
    sshPort,
    sshUser,
    sslEnabled,
    caCertificateName,
    authMethod,
    roleArn,
    roleExternalId,
  }: DatabaseIntegrationMetadataByType['redshift']
): SqlAlchemyInput | null => {
  if (authMethod && isFederatedAuthMethod(authMethod)) {
    return null
  }

  const portSuffix = port ? `:${port}` : ''
  const mode = getPostgresStyleMode(caCertificateName, sslEnabled)

  const vars: SqlAlchemyInput = {
    url: `redshift+psycopg2://${user}:${encodeURIComponent(password ?? '')}@${host}${portSuffix}/${database}`,
    params: {
      connect_args: {
        // these should ensure the redshift connection is kept alive https://stackoverflow.com/a/56325038/2761695
        keepalives: 1,
        keepalives_idle: 30,
        keepalives_interval: 10,
        keepalives_count: 5,

        sslmode: mode,
        sslrootcert: caCertificateName
          ? getCACertificatePath({
              projectRoot: projectRootDirectory,
              integrationId,
              caCertificateName,
            })
          : undefined,
      },
    },
    param_style: 'pyformat',
    ssh_options: {
      enabled: String(Boolean(sshEnabled)),
      host: sshHost,
      port: sshPort,
      user: sshUser,
    },
  }

  if (authMethod === AwsAuthMethods.IamRole && roleArn && roleExternalId) {
    vars.iamParams = {
      integrationId,
      type: 'redshift',
    }
  }

  return vars
}

function getPostgresStyleMode(caCertificateName?: string, sslEnabled?: boolean): string {
  if (caCertificateName) {
    return 'verify-ca'
  }

  if (sslEnabled) {
    return 'require'
  }

  return 'prefer'
}

const getMaterializePostgresSqlAlchemyInput = (
  integrationId: string,
  projectRootDirectory: string,
  {
    user,
    password,
    host,
    port,
    database,
    sshEnabled,
    sshHost,
    sshPort,
    sshUser,
    sslEnabled,
    caCertificateName,
    cluster,
  }: DatabaseIntegrationMetadataByType['materialize']
): SqlAlchemyInput => {
  const portSuffix = port ? `:${port}` : ''
  let mode: string
  if (caCertificateName) {
    mode = 'verify-ca'
  } else if (sslEnabled) {
    mode = 'require'
  } else {
    mode = 'prefer'
  }

  return {
    url: `postgresql://${user}:${encodeURIComponent(password)}@${host}${portSuffix}/${database}?options=--cluster%3D${cluster}`,
    params: {
      connect_args: {
        sslmode: mode,
        sslrootcert: caCertificateName
          ? getCACertificatePath({
              projectRoot: projectRootDirectory,
              integrationId,
              caCertificateName,
            })
          : undefined,
      },
    },
    param_style: 'pyformat',
    ssh_options: {
      enabled: String(sshEnabled),
      host: sshHost,
      port: sshPort,
      user: sshUser,
    },
  }
}

const getTrinoEnvVars = (
  integrationId: string,
  metadata: DatabaseIntegrationMetadataByType['trino'],
  projectRootDirectory: string
): SqlAlchemyInput => {
  const input: SqlAlchemyInput = {
    url: `trino://${encodeURIComponent(metadata.user)}:${metadata.password}@${metadata.host}:${metadata.port}/${encodeURIComponent(
      metadata.database
    )}`,
    params: {
      connect_args: {
        ...(metadata.sslEnabled ? { http_scheme: 'https' } : {}),
        ...(metadata.caCertificateName
          ? {
              verify: getCACertificatePath({
                projectRoot: projectRootDirectory,
                integrationId,
                caCertificateName: metadata.caCertificateName,
              }),
            }
          : {}),
      },
    },
    param_style: 'pyformat',
  }

  return input
}

const getAthenaSqlAlchemyInput = ({
  access_key_id,
  region,
  s3_output_path,
  secret_access_key,
  workgroup,
}: DatabaseIntegrationMetadataByType['athena']): SqlAlchemyInput => {
  // add schema_name to IntegrationMetadataAthena later if needed
  const schema_name = ''

  const baseUrl = `awsathena+rest://${access_key_id}:${encodeURIComponent(
    secret_access_key
  )}@athena.${region}.amazonaws.com:443/${schema_name}`

  const params = new URLSearchParams()

  params.set('s3_staging_dir', s3_output_path)

  if (workgroup) {
    params.set('work_group', workgroup)
  }

  const url = `${baseUrl}?${params.toString()}`

  return {
    url,
    params: {},
    param_style: 'pyformat',
  }
}

const getClickHouseSqlAlchemyInput = (
  integrationId: string,
  projectRootDirectory: string,
  {
    user,
    password,
    host,
    port,
    database,
    sshEnabled,
    sshHost,
    sshPort,
    sshUser,
    sslEnabled,
    caCertificateName,
  }: DatabaseIntegrationMetadataByType['clickhouse']
): SqlAlchemyInput => {
  const portSuffix = port ? `:${port}` : ''

  const params = new URLSearchParams()

  params.set('protocol', 'https')

  if (sslEnabled) {
    params.set('secure', 'true')
    params.set('tls_mode', 'strict')
  }

  if (caCertificateName) {
    const certificatePath = getCACertificatePath({
      projectRoot: projectRootDirectory,
      integrationId,
      caCertificateName,
    })

    //  https://requests.readthedocs.io/en/latest/user/advanced/#ssl-cert-verification
    params.set('verify', certificatePath)
  }

  const credentials = password ? `${user}:${encodeURIComponent(password)}` : user
  const url = `clickhouse://${credentials}@${host}${portSuffix}/${database}?${params.toString()}`

  const env: SqlAlchemyInput = {
    url,
    params: {},
    param_style: 'pyformat',
    ssh_options: {
      enabled: String(sshEnabled),
      host: sshHost,
      port: sshPort,
      user: sshUser,
    },
  }

  return env
}

export class BigQueryServiceAccountParseError extends Error {
  cause: Error
  constructor(message: string, params: { cause: Error }) {
    super(message)
    this.name = 'BigQueryServiceAccountParseError'
    this.cause = params.cause
  }
}

const getBigQuerySqlAlchemyInput = (
  metadata: DatabaseIntegrationMetadataByType['big-query']
): SqlAlchemyInput | null => {
  if (isFederatedAuthMetadata(metadata)) {
    return null
  }

  try {
    return {
      url: 'bigquery://',
      params: {
        credentials_info: JSON.parse(metadata.service_account),
      },
      param_style: 'pyformat',
    }
  } catch (error) {
    throw new BigQueryServiceAccountParseError(
      'Failed to parse bigquery service account, returning empty environment variable.',
      { cause: error instanceof Error ? error : new Error(String(error)) }
    )
  }
}

export class SpannerServiceAccountParseError extends Error {
  cause: Error
  constructor(message: string, params: { cause: Error }) {
    super(message)
    this.name = 'SpannerServiceAccountParseError'
    this.cause = params.cause
  }
}

const getSpannerSqlAlchemyInput = (metadata: DatabaseIntegrationMetadataByType['spanner']): SqlAlchemyInput | null => {
  try {
    const projectId = JSON.parse(metadata.service_account).project_id
    if (!projectId || typeof projectId !== 'string') {
      throw new SpannerServiceAccountParseError(
        'Failed to parse spanner service account, returning empty environment variable.',
        { cause: new Error('project_id is missing in service account') }
      )
    }

    return {
      url: `spanner+spanner:///projects/${projectId}/instances/${metadata.instance}/databases/${metadata.database}`,
      params: {},
      param_style: 'pyformat',
    }
  } catch (error) {
    if (error instanceof SpannerServiceAccountParseError) {
      throw error
    }

    throw new SpannerServiceAccountParseError(
      'Failed to parse spanner service account, returning empty environment variable.',
      { cause: error instanceof Error ? error : new Error(String(error)) }
    )
  }
}

export const bigQueryConnectionParamsForFederatedAuth = (
  metadata: Extract<DatabaseIntegrationMetadataByType['big-query'], { authMethod: FederatedAuthMethod }>,
  accessToken: string
): SqlAlchemyInput => {
  return {
    url: 'bigquery://?user_supplied_client=true',
    params: {
      access_token: accessToken,
      project: metadata.project,
    },
    param_style: 'pyformat',
  }
}

const getMySqlSqlAlchemyInput = (
  integrationId: string,
  projectRootDirectory: string,
  {
    user,
    password,
    host,
    port,
    database,
    sshEnabled,
    sshHost,
    sshPort,
    sshUser,
    caCertificateName,
  }: DatabaseIntegrationMetadataByType['mysql']
): SqlAlchemyInput => {
  const portSuffix = port ? `:${port}` : ''
  let ssl: { ca?: string; check_hostname: boolean } | { enable: boolean } | undefined
  if (caCertificateName) {
    ssl = {
      ca: getCACertificatePath({
        projectRoot: projectRootDirectory,
        integrationId,
        caCertificateName,
      }),
      check_hostname: false,
    }
  } else {
    ssl = {
      // This is a fake flag that enables SSL without MySQL client requiring a certificate file
      // Hack copied from https://stackoverflow.com/a/58434865/
      // SQL Alchemy docs: https://docs.sqlalchemy.org/en/14/dialects/mysql.html#ssl-connections
      enable: true,
    }
  }
  return {
    url: `mysql+pymysql://${user}:${encodeURIComponent(password)}@${host}${portSuffix}/${database}`,
    params: {
      connect_args: {
        ssl,
      },
    },
    param_style: 'pyformat',
    ssh_options: {
      enabled: String(sshEnabled),
      host: sshHost,
      port: sshPort,
      user: sshUser,
    },
  }
}

export function getCACertificatePath({
  projectRoot,
  integrationId,
  caCertificateName,
}: {
  projectRoot?: string
  integrationId: string
  caCertificateName: string
}) {
  return `${projectRoot ?? ''}/.deepnote/${integrationId}/${caCertificateName}`
}

function convertToEnvironmentVariableName(str: string) {
  // Environment variable names used by the utilities in the Shell and Utilities volume of IEEE Std 1003.1-2001
  // consist solely of uppercase letters, digits, and the '_' (underscore) from the characters defined in
  // Portable Character Set and do not begin with a digit.
  const notFirstDigit = /^\d/.test(str) ? `_${str}` : str
  const upperCased = notFirstDigit.toUpperCase()
  return upperCased.replace(/[^\w]/gm, '_')
}

export function getSqlEnvVarName(integrationId: string): string {
  return `SQL_${integrationId}`
}
