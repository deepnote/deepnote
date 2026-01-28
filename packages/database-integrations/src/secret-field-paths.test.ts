import { describe, expect, it } from 'vitest'
import { databaseIntegrationTypes } from './database-integration-types'
import { getAllSecretFieldPaths, getSecretFieldPaths, isSecretField } from './secret-field-paths'
import {
  BigQueryAuthMethods,
  DatabaseAuthMethods,
  SnowflakeAuthMethods,
  TrinoAuthMethods,
} from './sql-integration-auth-methods'

describe('getSecretFieldPaths', () => {
  describe('simple integrations (no auth method variants)', () => {
    it('returns password and caCertificateText for alloydb', () => {
      expect(getSecretFieldPaths('alloydb')).toEqual(['password', 'caCertificateText'])
    })

    it('returns password and caCertificateText for mariadb', () => {
      expect(getSecretFieldPaths('mariadb')).toEqual(['password', 'caCertificateText'])
    })

    it('returns password and caCertificateText for materialize', () => {
      expect(getSecretFieldPaths('materialize')).toEqual(['password', 'caCertificateText'])
    })

    it('returns password and caCertificateText for mindsdb', () => {
      expect(getSecretFieldPaths('mindsdb')).toEqual(['password', 'caCertificateText'])
    })

    it('returns password and caCertificateText for mysql', () => {
      expect(getSecretFieldPaths('mysql')).toEqual(['password', 'caCertificateText'])
    })

    it('returns password and caCertificateText for pgsql', () => {
      expect(getSecretFieldPaths('pgsql')).toEqual(['password', 'caCertificateText'])
    })

    it('returns password for sql-server', () => {
      expect(getSecretFieldPaths('sql-server')).toEqual(['password'])
    })

    it('returns password and caCertificateText for clickhouse', () => {
      expect(getSecretFieldPaths('clickhouse')).toEqual(['password', 'caCertificateText'])
    })

    it('returns token for databricks', () => {
      expect(getSecretFieldPaths('databricks')).toEqual(['token'])
    })

    it('returns token for dremio', () => {
      expect(getSecretFieldPaths('dremio')).toEqual(['token'])
    })

    it('returns secret_access_key for athena', () => {
      expect(getSecretFieldPaths('athena')).toEqual(['secret_access_key'])
    })

    it('returns service_account for spanner', () => {
      expect(getSecretFieldPaths('spanner')).toEqual(['service_account'])
    })

    it('returns connection string related secrets for mongodb', () => {
      expect(getSecretFieldPaths('mongodb')).toEqual([
        'password',
        'connection_string',
        'rawConnectionString',
        'caCertificateText',
      ])
    })

    it('returns empty array for pandas-dataframe', () => {
      expect(getSecretFieldPaths('pandas-dataframe')).toEqual([])
    })
  })

  describe('bigquery auth method variants', () => {
    it('returns service_account for service-account auth method', () => {
      expect(getSecretFieldPaths('big-query', BigQueryAuthMethods.ServiceAccount)).toEqual(['service_account'])
    })

    it('returns clientSecret for google-oauth auth method', () => {
      expect(getSecretFieldPaths('big-query', BigQueryAuthMethods.GoogleOauth)).toEqual(['clientSecret'])
    })

    it('returns default (service_account) when no auth method specified', () => {
      expect(getSecretFieldPaths('big-query')).toEqual(['service_account'])
    })

    it('returns default (service_account) when auth method is null', () => {
      expect(getSecretFieldPaths('big-query', null)).toEqual(['service_account'])
    })
  })

  describe('snowflake auth method variants', () => {
    it('returns password for password auth method', () => {
      expect(getSecretFieldPaths('snowflake', SnowflakeAuthMethods.Password)).toEqual(['password'])
    })

    it('returns clientSecret for okta auth method', () => {
      expect(getSecretFieldPaths('snowflake', SnowflakeAuthMethods.Okta)).toEqual(['clientSecret'])
    })

    it('returns clientSecret for native snowflake auth method', () => {
      expect(getSecretFieldPaths('snowflake', SnowflakeAuthMethods.NativeSnowflake)).toEqual(['clientSecret'])
    })

    it('returns clientSecret for azure auth method', () => {
      expect(getSecretFieldPaths('snowflake', SnowflakeAuthMethods.AzureAd)).toEqual(['clientSecret'])
    })

    it('returns empty array for key-pair auth method (per-user keys)', () => {
      expect(getSecretFieldPaths('snowflake', SnowflakeAuthMethods.KeyPair)).toEqual([])
    })

    it('returns privateKey and privateKeyPassphrase for service-account-key-pair auth method', () => {
      expect(getSecretFieldPaths('snowflake', SnowflakeAuthMethods.ServiceAccountKeyPair)).toEqual([
        'privateKey',
        'privateKeyPassphrase',
      ])
    })

    it('returns default (password) when no auth method specified', () => {
      expect(getSecretFieldPaths('snowflake')).toEqual(['password'])
    })

    it('returns default (password) when auth method is null', () => {
      expect(getSecretFieldPaths('snowflake', null)).toEqual(['password'])
    })
  })

  describe('redshift auth method variants', () => {
    it('returns password and caCertificateText for username-and-password auth method', () => {
      expect(getSecretFieldPaths('redshift', DatabaseAuthMethods.UsernameAndPassword)).toEqual([
        'password',
        'caCertificateText',
      ])
    })

    it('returns caCertificateText for individual-credentials auth method', () => {
      expect(getSecretFieldPaths('redshift', DatabaseAuthMethods.IndividualCredentials)).toEqual(['caCertificateText'])
    })

    it('returns caCertificateText for iam-role auth method', () => {
      expect(getSecretFieldPaths('redshift', 'iam-role')).toEqual(['caCertificateText'])
    })

    it('returns default (password and caCertificateText) when no auth method specified', () => {
      expect(getSecretFieldPaths('redshift')).toEqual(['password', 'caCertificateText'])
    })

    it('returns default (password and caCertificateText) when auth method is null', () => {
      expect(getSecretFieldPaths('redshift', null)).toEqual(['password', 'caCertificateText'])
    })
  })

  describe('trino auth method variants', () => {
    it('returns password and caCertificateText for password auth method', () => {
      expect(getSecretFieldPaths('trino', TrinoAuthMethods.Password)).toEqual(['password', 'caCertificateText'])
    })

    it('returns clientSecret and caCertificateText for oauth auth method', () => {
      expect(getSecretFieldPaths('trino', TrinoAuthMethods.Oauth)).toEqual(['clientSecret', 'caCertificateText'])
    })

    it('returns default (password and caCertificateText) when no auth method specified', () => {
      expect(getSecretFieldPaths('trino')).toEqual(['password', 'caCertificateText'])
    })

    it('returns default (password and caCertificateText) when auth method is null', () => {
      expect(getSecretFieldPaths('trino', null)).toEqual(['password', 'caCertificateText'])
    })
  })

  describe('unknown auth method fallback', () => {
    it('returns default for unknown auth method on bigquery', () => {
      expect(getSecretFieldPaths('big-query', 'unknown-auth')).toEqual(['service_account'])
    })

    it('returns default for unknown auth method on snowflake', () => {
      expect(getSecretFieldPaths('snowflake', 'unknown-auth')).toEqual(['password'])
    })

    it('returns default for unknown auth method on redshift', () => {
      expect(getSecretFieldPaths('redshift', 'unknown-auth')).toEqual(['password', 'caCertificateText'])
    })

    it('returns default for unknown auth method on trino', () => {
      expect(getSecretFieldPaths('trino', 'unknown-auth')).toEqual(['password', 'caCertificateText'])
    })
  })
})

describe('isSecretField', () => {
  it('returns true for password field on pgsql', () => {
    expect(isSecretField('pgsql', 'password')).toBe(true)
  })

  it('returns true for caCertificateText field on pgsql', () => {
    expect(isSecretField('pgsql', 'caCertificateText')).toBe(true)
  })

  it('returns false for host field on pgsql', () => {
    expect(isSecretField('pgsql', 'host')).toBe(false)
  })

  it('returns false for database field on pgsql', () => {
    expect(isSecretField('pgsql', 'database')).toBe(false)
  })

  it('returns true for token field on databricks', () => {
    expect(isSecretField('databricks', 'token')).toBe(true)
  })

  it('returns false for host field on databricks', () => {
    expect(isSecretField('databricks', 'host')).toBe(false)
  })

  it('handles auth method variants correctly', () => {
    expect(isSecretField('snowflake', 'password', SnowflakeAuthMethods.Password)).toBe(true)
    expect(isSecretField('snowflake', 'clientSecret', SnowflakeAuthMethods.Password)).toBe(false)
    expect(isSecretField('snowflake', 'clientSecret', SnowflakeAuthMethods.Okta)).toBe(true)
    expect(isSecretField('snowflake', 'password', SnowflakeAuthMethods.Okta)).toBe(false)
  })
})

describe('getAllSecretFieldPaths', () => {
  it('returns a mapping for all integration types', () => {
    const allPaths = getAllSecretFieldPaths()

    // Verify all integration types are covered
    for (const type of databaseIntegrationTypes) {
      expect(allPaths).toHaveProperty(type)
      expect(Array.isArray(allPaths[type])).toBe(true)
    }
  })

  it('combines all possible secrets for auth-method-variant integrations', () => {
    const allPaths = getAllSecretFieldPaths()

    // BigQuery should have both service_account and clientSecret
    expect(allPaths['big-query']).toContain('service_account')
    expect(allPaths['big-query']).toContain('clientSecret')

    // Snowflake should have password, clientSecret, privateKey, and privateKeyPassphrase
    expect(allPaths.snowflake).toContain('password')
    expect(allPaths.snowflake).toContain('clientSecret')
    expect(allPaths.snowflake).toContain('privateKey')
    expect(allPaths.snowflake).toContain('privateKeyPassphrase')

    // Trino should have password and clientSecret
    expect(allPaths.trino).toContain('password')
    expect(allPaths.trino).toContain('clientSecret')
    expect(allPaths.trino).toContain('caCertificateText')
  })

  it('returns correct paths for simple integrations', () => {
    const allPaths = getAllSecretFieldPaths()

    expect(allPaths.pgsql).toEqual(['password', 'caCertificateText'])
    expect(allPaths.databricks).toEqual(['token'])
    expect(allPaths.athena).toEqual(['secret_access_key'])
    expect(allPaths['pandas-dataframe']).toEqual([])
  })
})
