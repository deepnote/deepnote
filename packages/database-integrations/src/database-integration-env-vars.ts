import type { DatabaseIntegrationConfig, SqlIntegrationConfig } from './database-integration-config'
import type { DatabaseIntegrationMetadataByType } from './database-integration-metadata-schemas'
import { getValidFederatedAuthToken } from './federated-auth-tokens'
import { getSnowflakeSqlAlchemyInput } from './snowflake-integration-env-vars'
import type { SqlAlchemyInput } from './sql-alchemy-types'
import {
  AwsAuthMethods,
  DatabaseAuthMethods,
  isFederatedAuthMetadata,
  isFederatedAuthMethod,
  TrinoAuthMethods,
} from './sql-integration-auth-methods'

export interface EnvVar {
  name: string
  value: string
}

export interface GetEnvironmentVariablesForIntegrationsParams {
  projectRootDirectory: string
  snowflakePartnerIdentifier?: string
  /**
   * Optional path to the federated auth tokens file (~/.deepnote/federated-auth-tokens.yaml).
   * When provided, federated auth integrations (e.g., Trino OAuth) will load tokens from this
   * file and inject the SQL connection env var.
   */
  federatedAuthTokensFilePath?: string
}

export async function getEnvironmentVariablesForIntegrations(
  integrations: Array<DatabaseIntegrationConfig>,
  params: GetEnvironmentVariablesForIntegrationsParams
): Promise<{
  envVars: Array<EnvVar>
  errors: Array<Error>
}> {
  const envVars: Array<EnvVar> = []
  const errors: Array<Error> = []

  for (const integration of integrations) {
    const namePrefix = convertToEnvironmentVariableName(integration.name)

    const envVarsForThisIntegration: Array<EnvVar> = Object.entries(integration.metadata)
      .filter(([key]) => {
        // Filter out caCertificateText - we only provide the path, not the cert text
        return key !== 'caCertificateText'
      })
      .map(([key, rawValue]) => {
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
      const isFederated =
        integration.federated_auth_method != null && isFederatedAuthMethod(integration.federated_auth_method)

      if (isFederated && params.federatedAuthTokensFilePath) {
        try {
          const accessToken = await getValidFederatedAuthToken(integration, params.federatedAuthTokensFilePath)
          if (accessToken && integration.type === 'trino' && integration.federated_auth_method === 'trino-oauth') {
            const metadata = integration.metadata as Extract<
              DatabaseIntegrationMetadataByType['trino'],
              { authMethod: typeof TrinoAuthMethods.Oauth }
            >
            const sqlAlchemyInput = buildTrinoOAuthSqlAlchemyInput(
              integration.id,
              metadata,
              accessToken,
              params.projectRootDirectory
            )
            envVarsForThisIntegration.push({
              name: getSqlEnvVarName(integration.id),
              value: JSON.stringify({ integration_id: integration.id, ...sqlAlchemyInput }),
            })
          }
        } catch (error) {
          errors.push(error as Error)
        }
      } else if (!isFederated) {
        try {
          const envVar = getEnvVarForSqlCells(integration, params)
          if (envVar) {
            envVarsForThisIntegration.push(envVar)
          }
        } catch (error) {
          errors.push(error as Error)
        }
      }
    }

    envVars.push(...envVarsForThisIntegration.filter(envVar => !!envVar.name))
  }

  return { envVars, errors }
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
    name: getSqlEnvVarName(integration.id),
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
  if (integration.federated_auth_method != null && isFederatedAuthMethod(integration.federated_auth_method)) {
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
      return {
        url: `deepnote+duckdb:///:memory:`,
        params: {},
        param_style: 'qmark',
      }

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
    url: `databricks+connector://token:${encodeURIComponent(token)}@${host}:${port}`,
    params: {
      connect_args: {
        http_path: httpPath,
        schema,
        catalog,
      },
    },
    param_style: 'pyformat',
    ssh_options: sshEnabled
      ? {
          enabled: true,
          host: sshHost,
          port: sshPort,
          user: sshUser,
        }
      : {},
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
  const url = new URL(`dremio+flight://${host}:${port}${schema ? `/${schema}` : ''}`)
  // Always true.
  url.searchParams.set('UseEncryption', 'true')
  url.searchParams.set('Token', token)

  return {
    url: url.href,
    params: {},
    param_style: 'pyformat',
    ssh_options: sshEnabled
      ? {
          enabled: true,
          host: sshHost,
          port: sshPort,
          user: sshUser,
        }
      : {},
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
    url: `mssql+pymssql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}${portSuffix}/${database}`,
    params: {},
    param_style: 'pyformat',
    ssh_options: sshEnabled
      ? {
          enabled: true,
          host: sshHost,
          port: sshPort,
          user: sshUser,
        }
      : {},
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
  }: DatabaseIntegrationMetadataByType['alloydb'] | DatabaseIntegrationMetadataByType['pgsql']
): SqlAlchemyInput => {
  const portSuffix = port ? `:${port}` : ''
  const mode = getPostgresStyleMode(caCertificateName, sslEnabled)

  return {
    url: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}${portSuffix}/${database}`,
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
    ssh_options: sshEnabled
      ? {
          enabled: true,
          host: sshHost,
          port: sshPort,
          user: sshUser,
        }
      : {},
  }
}

export const getRedshiftSqlAlchemyInput = (
  integrationId: string,
  projectRootDirectory: string,
  metadata: DatabaseIntegrationMetadataByType['redshift']
): SqlAlchemyInput | null => {
  if (!metadata.authMethod) {
    // Legacy integrations may not have an authMethod, so we default to username-and-password.
    metadata.authMethod = DatabaseAuthMethods.UsernameAndPassword
  }

  if (isFederatedAuthMethod(metadata.authMethod)) {
    return null
  }

  const portSuffix = metadata.port ? `:${metadata.port}` : ''
  const mode = getPostgresStyleMode(metadata.caCertificateName, metadata.sslEnabled)

  // NOTE: For IAM role and individual credentials, these will be injected by the caller
  const credentials =
    metadata.authMethod === DatabaseAuthMethods.UsernameAndPassword
      ? `${encodeURIComponent(metadata.user)}:${encodeURIComponent(metadata.password)}`
      : ''

  const vars: SqlAlchemyInput = {
    url: `redshift+psycopg2://${credentials ? `${credentials}@` : ''}${metadata.host}${portSuffix}/${metadata.database}`,
    params: {
      connect_args: {
        // these should ensure the redshift connection is kept alive https://stackoverflow.com/a/56325038/2761695
        keepalives: 1,
        keepalives_idle: 30,
        keepalives_interval: 10,
        keepalives_count: 5,

        sslmode: mode,
        sslrootcert: metadata.caCertificateName
          ? getCACertificatePath({
              projectRoot: projectRootDirectory,
              integrationId,
              caCertificateName: metadata.caCertificateName,
            })
          : undefined,
      },
    },
    param_style: 'pyformat',
    ssh_options: metadata.sshEnabled
      ? {
          enabled: true,
          host: metadata.sshHost,
          port: metadata.sshPort,
          user: metadata.sshUser,
        }
      : {},
  }

  if (metadata.authMethod === AwsAuthMethods.IamRole && metadata.roleArn && metadata.roleExternalId) {
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
  const mode = getPostgresStyleMode(caCertificateName, sslEnabled)

  return {
    url: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}${portSuffix}/${database}?options=--cluster%3D${cluster}`,
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
    ssh_options: sshEnabled
      ? {
          enabled: true,
          host: sshHost,
          port: sshPort,
          user: sshUser,
        }
      : {},
  }
}

const getTrinoEnvVars = (
  integrationId: string,
  metadata: DatabaseIntegrationMetadataByType['trino'],
  projectRootDirectory: string
): SqlAlchemyInput | null => {
  // OAuth is a federated auth method, handled separately
  if (metadata.authMethod === TrinoAuthMethods.Oauth) {
    return null
  }

  // At this point, metadata must be password auth (either with authMethod: 'password' or authMethod: null)
  const input: SqlAlchemyInput = {
    url: `trino://${encodeURIComponent(metadata.user)}:${encodeURIComponent(metadata.password)}@${metadata.host}:${metadata.port}/${encodeURIComponent(
      metadata.database
    )}`,
    params: {
      connect_args: {
        client_tags: ['deepnote/toolkit'],
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
    param_style: 'qmark',
  }

  return input
}

/**
 * Build SqlAlchemy input for Trino with OAuth access token.
 * Used when federated auth tokens are available (e.g., from CLI tokens file).
 */
export function buildTrinoOAuthSqlAlchemyInput(
  integrationId: string,
  metadata: Extract<DatabaseIntegrationMetadataByType['trino'], { authMethod: typeof TrinoAuthMethods.Oauth }>,
  accessToken: string,
  projectRootDirectory: string
): SqlAlchemyInput {
  const port = metadata.port ?? '8443'
  const input: SqlAlchemyInput = {
    url: `trino://${metadata.host}:${port}/${encodeURIComponent(metadata.database)}`,
    params: {
      connect_args: {
        http_headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        http_scheme: 'https',
        client_tags: ['deepnote/toolkit'],
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
    param_style: 'qmark',
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

  const baseUrl = `awsathena+rest://${encodeURIComponent(access_key_id)}:${encodeURIComponent(
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

  const credentials = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user)
  const url = `clickhouse://${credentials}@${host}${portSuffix}/${database}?${params.toString()}`

  const env: SqlAlchemyInput = {
    url,
    params: {},
    param_style: 'pyformat',
    ssh_options: sshEnabled
      ? {
          enabled: true,
          host: sshHost,
          port: sshPort,
          user: sshUser,
        }
      : {},
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
  }:
    | DatabaseIntegrationMetadataByType['mariadb']
    | DatabaseIntegrationMetadataByType['mindsdb']
    | DatabaseIntegrationMetadataByType['mysql']
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
    url: `mysql+pymysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}${portSuffix}/${database}`,
    params: {
      connect_args: {
        ssl,
      },
    },
    param_style: 'pyformat',
    ssh_options: sshEnabled
      ? {
          enabled: true,
          host: sshHost,
          port: sshPort,
          user: sshUser,
        }
      : {},
  }
}

function getCACertificatePath({
  projectRoot,
  integrationId,
  caCertificateName,
}: {
  projectRoot: string
  integrationId: string
  caCertificateName: string
}) {
  return `${projectRoot}/.deepnote/${integrationId}/${caCertificateName}`
}

function convertToEnvironmentVariableName(str: string) {
  // Environment variable names used by the utilities in the Shell and Utilities volume of IEEE Std 1003.1-2001
  // consist solely of uppercase letters, digits, and the '_' (underscore) from the characters defined in
  // Portable Character Set and do not begin with a digit.
  const notFirstDigit = /^\d/.test(str) ? `_${str}` : str
  const upperCased = notFirstDigit.toUpperCase()
  return upperCased.replace(/[^\w]/g, '_')
}

export function getSqlEnvVarName(integrationId: string): string {
  return convertToEnvironmentVariableName(`SQL_${integrationId}`)
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${value}`)
}
