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
    const url = buildUrl(`snowflake://${encodeURIComponent(username)}@${encodeURIComponent(accountName)}`, {
      path: database,
      queryParams: {
        ...createBaseQueryParams(metadata, params.snowflakePartnerIdentifier),
        authenticator: 'snowflake_jwt',
      },
    })

    return createSqlAlchemyInputFromUrl(url, {
      privateKey: metadata.privateKey,
      password: metadata.privateKeyPassphrase,
      username: metadata.username,
    })
  }

  const url = buildUrl(
    `snowflake://${encodeURIComponent(username)}:${encodeURIComponent(metadata.password)}@${encodeURIComponent(accountName)}`,
    {
      path: database,
      queryParams: {
        ...createBaseQueryParams(metadata, params.snowflakePartnerIdentifier),
      },
    }
  )

  return createSqlAlchemyInputFromUrl(url)
}

interface SnowflakeConnectionParamsForFederatedAuthOptions {
  accessToken?: string
  keyPair?: SnowflakeKeyPair
  /** If passed, overrides the default role in the metadata */
  role?: string
  snowflakePartnerIdentifier?: string
}

export function getSnowflakeFederatedAuthSqlAlchemyInput(
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
  }
  if (options.role) {
    queryParams.role = options.role
  }

  if (options.accessToken) {
    queryParams.token = options.accessToken
    queryParams.authenticator = 'oauth'
  }

  const accountIdentifier = metadata.accountName.replace('.privatelink', '')
  const baseUrl = options.keyPair?.username
    ? `snowflake://${encodeURIComponent(options.keyPair.username)}@${encodeURIComponent(accountIdentifier)}`
    : `snowflake://:@${encodeURIComponent(accountIdentifier)}`

  const url = buildUrl(baseUrl, {
    path: metadata.database,
    queryParams,
  })

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
        snowflake_private_key: btoa(keyPair.privateKey),
        ...(keyPair.password ? { snowflake_private_key_passphrase: keyPair.password } : {}),
      }
    : {}

  return {
    url,
    params,
    param_style: 'pyformat',
  }
}
