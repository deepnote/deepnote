import { escape as escapeUrlPart } from 'node:querystring'
import buildUrl from 'build-url-ts'
import type { DatabaseIntegrationMetadataByType } from './database-integration-metadata-schemas'
import type { SqlAlchemyInput } from './sql-alchemy-types'
import { type FederatedAuthMethod, isFederatedAuthMetadata, SnowflakeAuthMethods } from './sql-integration-auth-methods'

export function getSnowflakeSqlAlchemyInput(
  metadata: DatabaseIntegrationMetadataByType['snowflake'],
  params: {
    /** This is configured in Snowflake partner program dashboard: spn.snowflake.com */
    snowflakePartnerIdentifier?: string
  }
): SqlAlchemyInput | null {
  if (isFederatedAuthMetadata(metadata)) {
    return null
  }

  const { username, accountName, database, authMethod } = metadata

  if (authMethod === SnowflakeAuthMethods.ServiceAccountKeyPair) {
    const url = buildUrl(`snowflake://${username}@${accountName}`, {
      path: database,
      queryParams: {
        ...createBaseQueryParams(metadata, params.snowflakePartnerIdentifier),
        authenticator: 'snowflake_jwt',
      },
    })

    if (!url) {
      throw new Error('getSnowflakeEnvVar URL must be defined')
    }

    return createSqlAlchemyInputFromUrl(url, {
      privateKey: metadata.privateKey,
      password: metadata.privateKeyPassphrase,
      username: metadata.username,
    })
  }

  const url = buildUrl(`snowflake://${username}:${escapeUrlPart(metadata.password)}@${accountName}`, {
    path: database,
    queryParams: {
      ...createBaseQueryParams(metadata, params.snowflakePartnerIdentifier),
    },
  })

  if (!url) {
    throw new Error('getSnowflakeEnvVar URL must be defined')
  }

  return createSqlAlchemyInputFromUrl(url)
}

interface SnowflakeConnectionParamsForFederatedAuthOptions {
  accessToken?: string
  keyPair?: SnowflakeKeyPair
  /** If passed, overrides the default role in the metadata */
  role?: string
  snowflakePartnerIdentifier?: string
}

export function snowflakeConnectionParamsForFederatedAuth(
  metadata: Extract<DatabaseIntegrationMetadataByType['snowflake'], { authMethod: FederatedAuthMethod }>,
  options: SnowflakeConnectionParamsForFederatedAuthOptions = {}
): SqlAlchemyInput {
  return createSqlAlchemyInputFromUrl(buildSnowflakeUrlForFederatedAuth(metadata, options), options.keyPair)
}

function buildSnowflakeUrlForFederatedAuth(
  metadata: Extract<DatabaseIntegrationMetadataByType['snowflake'], { authMethod: FederatedAuthMethod }>,
  options: SnowflakeConnectionParamsForFederatedAuthOptions
): string {
  const queryParams: Record<string, string | undefined> = {
    ...createBaseQueryParams(metadata, options.snowflakePartnerIdentifier),
    role: options.role,
  }

  if (options.accessToken) {
    queryParams.token = options.accessToken
    queryParams.authenticator = 'oauth'
  }

  const accountIdentifier = metadata.accountName.replace('.privatelink', '')
  const baseUrl = options.keyPair?.username
    ? `snowflake://${options.keyPair.username}@${accountIdentifier}`
    : `snowflake://:@${accountIdentifier}`

  const url = buildUrl(baseUrl, {
    path: metadata.database,
    queryParams,
  })

  if (!url) {
    throw new Error('buildSnowflakeUrlForFederatedAuth URL must be defined')
  }

  return url
}

function createBaseQueryParams(
  metadata: DatabaseIntegrationMetadataByType['snowflake'],
  snowflakePartnerIdentifier: string | undefined
) {
  return {
    warehouse: metadata.warehouse,
    role: metadata.role,
    application: snowflakePartnerIdentifier,
  }
}

export interface SnowflakeKeyPair {
  password?: string | null
  privateKey: string
  username: string
}

function createSqlAlchemyInputFromUrl(
  url: string,
  keyPair?:
    | SnowflakeKeyPair
    | {
        privateKey: string
        password?: string
        username: string
      }
): SqlAlchemyInput {
  const params = keyPair
    ? {
        snowflake_private_key: Buffer.from(keyPair.privateKey).toString('base64'),
        snowflake_private_key_passphrase: keyPair.password || undefined,
      }
    : {}

  return {
    url,
    params,
    param_style: 'pyformat',
  }
}
