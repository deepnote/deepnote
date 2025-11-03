import { describe, expect, it } from 'vitest'
import { getSnowflakeFederatedAuthSqlAlchemyInput } from './snowflake-integration-env-vars'

describe('Snowflake federated auth', () => {
  describe('getSnowflakeFederatedAuthSqlAlchemyInput', () => {
    it('should generate a SQL Alchemy env var with snowflake URL for access token auth', () => {
      const url = getSnowflakeFederatedAuthSqlAlchemyInput(
        {
          authMethod: 'snowflake',
          clientId: 'my-client-id',
          clientSecret: 'my-client-secret',
          accountName: 'my-account-name',
          warehouse: 'my-warehouse',
          database: 'my-database',
          role: 'my-role',
        },
        {
          accessToken: 'my-access-token',
        }
      )

      expect(url).toStrictEqual({
        url: expect.urlWithQueryParams(
          'snowflake://:@my-account-name/my-database?warehouse=my-warehouse&role=my-role&token=my-access-token&authenticator=oauth'
        ),
        params: {},
        param_style: 'pyformat',
      })
    })

    it('should generate a SQL Alchemy env var with snowflake URL for key pair auth', () => {
      const url = getSnowflakeFederatedAuthSqlAlchemyInput(
        {
          authMethod: 'snowflake',
          clientId: 'my-client-id',
          clientSecret: 'my-client-secret',
          accountName: 'my-account-name',
          warehouse: 'my-warehouse',
          database: 'my-database',
          role: 'my-role',
        },
        {
          keyPair: {
            username: 'my-username',
            privateKey: 'my-private-key',
            password: 'my-private-key-passphrase',
          },
        }
      )

      expect(url).toStrictEqual({
        url: expect.urlWithQueryParams(
          'snowflake://my-username@my-account-name/my-database?warehouse=my-warehouse&role=my-role'
        ),
        params: {
          snowflake_private_key: btoa('my-private-key'),
          snowflake_private_key_passphrase: 'my-private-key-passphrase',
        },
        param_style: 'pyformat',
      })
    })

    it('should generate a SQL Alchemy env var with snowflake URL for key pair auth without passphrase', () => {
      const url = getSnowflakeFederatedAuthSqlAlchemyInput(
        {
          authMethod: 'snowflake',
          clientId: 'my-client-id',
          clientSecret: 'my-client-secret',
          accountName: 'my-account-name',
          warehouse: 'my-warehouse',
          database: 'my-database',
          role: 'my-role',
        },
        {
          keyPair: {
            username: 'my-username',
            privateKey: 'my-private-key',
          },
        }
      )

      expect(url).toStrictEqual({
        url: expect.urlWithQueryParams(
          'snowflake://my-username@my-account-name/my-database?warehouse=my-warehouse&role=my-role'
        ),
        params: {
          snowflake_private_key: btoa('my-private-key'),
        },
        param_style: 'pyformat',
      })
    })

    it('should generate a SQL Alchemy env var with snowflake URL for key pair auth with role override', () => {
      const url = getSnowflakeFederatedAuthSqlAlchemyInput(
        {
          authMethod: 'snowflake',
          clientId: 'my-client-id',
          clientSecret: 'my-client-secret',
          accountName: 'my-account-name',
          warehouse: 'my-warehouse',
          database: 'my-database',
          role: 'my-role',
        },
        {
          keyPair: {
            username: 'my-username',
            privateKey: 'my-private-key',
          },
          role: 'my-overridden-role',
        }
      )

      expect(url).toStrictEqual({
        url: expect.urlWithQueryParams(
          'snowflake://my-username@my-account-name/my-database?warehouse=my-warehouse&role=my-overridden-role'
        ),
        params: {
          snowflake_private_key: btoa('my-private-key'),
        },
        param_style: 'pyformat',
      })
    })

    it('should generate a SQL Alchemy env var with snowflake URL for key pair auth with snowflake partner identifier', () => {
      const url = getSnowflakeFederatedAuthSqlAlchemyInput(
        {
          authMethod: 'snowflake',
          clientId: 'my-client-id',
          clientSecret: 'my-client-secret',
          accountName: 'my-account-name',
          warehouse: 'my-warehouse',
          database: 'my-database',
          role: 'my-role',
        },
        {
          keyPair: {
            username: 'my-username',
            privateKey: 'my-private-key',
          },
          snowflakePartnerIdentifier: 'my-snowflake-partner-identifier',
        }
      )

      expect(url).toStrictEqual({
        url: expect.urlWithQueryParams(
          'snowflake://my-username@my-account-name/my-database?warehouse=my-warehouse&role=my-role&application=my-snowflake-partner-identifier'
        ),
        params: {
          snowflake_private_key: btoa('my-private-key'),
        },
        param_style: 'pyformat',
      })
    })

    it('should generate a SQL Alchemy env var with snowflake URL for key pair auth with role override and snowflake partner identifier', () => {
      const url = getSnowflakeFederatedAuthSqlAlchemyInput(
        {
          authMethod: 'snowflake',
          clientId: 'my-client-id',
          clientSecret: 'my-client-secret',
          accountName: 'my-account-name',
          warehouse: 'my-warehouse',
          database: 'my-database',
          role: 'my-role',
        },
        {
          keyPair: {
            username: 'my-username',
            privateKey: 'my-private-key',
          },
          role: 'my-overridden-role',
          snowflakePartnerIdentifier: 'my-snowflake-partner-identifier',
        }
      )

      expect(url).toStrictEqual({
        url: expect.urlWithQueryParams(
          'snowflake://my-username@my-account-name/my-database?warehouse=my-warehouse&role=my-overridden-role&application=my-snowflake-partner-identifier'
        ),
        params: {
          snowflake_private_key: btoa('my-private-key'),
        },
        param_style: 'pyformat',
      })
    })

    // okta
    it('should generate a SQL Alchemy env var with snowflake URL for okta auth', () => {
      const url = getSnowflakeFederatedAuthSqlAlchemyInput(
        {
          authMethod: 'okta',
          clientId: 'my-client-id',
          clientSecret: 'my-client-secret',
          oktaSubdomain: 'my-okta-subdomain',
          identityProvider: 'my-identity-provider',
          authorizationServer: 'my-authorization-server',
          accountName: 'my-account-name',
          warehouse: 'my-warehouse',
          database: 'my-database',
          role: 'my-role',
        },
        {
          accessToken: 'my-access-token',
        }
      )

      expect(url).toStrictEqual({
        url: expect.urlWithQueryParams(
          'snowflake://:@my-account-name/my-database?warehouse=my-warehouse&role=my-role&token=my-access-token&authenticator=oauth'
        ),
        params: {},
        param_style: 'pyformat',
      })
    })

    it('should generate a SQL Alchemy env var with snowflake URL for AzureAD auth', () => {
      const url = getSnowflakeFederatedAuthSqlAlchemyInput(
        {
          authMethod: 'azure',
          clientId: 'my-client-id',
          clientSecret: 'my-client-secret',
          resource: 'my-resource',
          tenant: 'my-tenant',
          accountName: 'my-account-name',
          warehouse: 'my-warehouse',
          database: 'my-database',
          role: 'my-role',
        },
        {
          accessToken: 'my-access-token',
        }
      )

      expect(url).toStrictEqual({
        url: expect.urlWithQueryParams(
          'snowflake://:@my-account-name/my-database?warehouse=my-warehouse&role=my-role&token=my-access-token&authenticator=oauth'
        ),
        params: {},
        param_style: 'pyformat',
      })
    })
  })
})
