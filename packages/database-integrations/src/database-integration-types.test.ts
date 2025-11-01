import { describe, expect, it } from 'vitest'
import {
  databaseIntegrationTypes,
  databaseIntegrationTypesWithSslSupport,
  sqlIntegrationTypes,
} from './database-integration-types'

describe('Integration types', () => {
  describe('SQL integration types', () => {
    it('should contain all SQL integration types', () => {
      expect(sqlIntegrationTypes).toContain('alloydb')
      expect(sqlIntegrationTypes).toContain('athena')
      expect(sqlIntegrationTypes).toContain('big-query')
      expect(sqlIntegrationTypes).toContain('clickhouse')
      expect(sqlIntegrationTypes).toContain('databricks')
      expect(sqlIntegrationTypes).toContain('dremio')
      expect(sqlIntegrationTypes).toContain('mariadb')
      expect(sqlIntegrationTypes).toContain('materialize')
      expect(sqlIntegrationTypes).toContain('mindsdb')
      expect(sqlIntegrationTypes).toContain('mysql')
      expect(sqlIntegrationTypes).toContain('pgsql')
      expect(sqlIntegrationTypes).toContain('redshift')
      expect(sqlIntegrationTypes).toContain('snowflake')
      expect(sqlIntegrationTypes).toContain('spanner')
      expect(sqlIntegrationTypes).toContain('sql-server')
      expect(sqlIntegrationTypes).toContain('trino')
    })

    it('should not contain mongodb', () => {
      expect(sqlIntegrationTypes).not.toContain('mongodb')
    })
  })

  describe('Database integration types', () => {
    it('should contain all SQL integration types', () => {
      sqlIntegrationTypes.forEach(type => {
        expect(databaseIntegrationTypes).toContain(type)
      })
    })

    it('should contain mongodb', () => {
      expect(databaseIntegrationTypes).toContain('mongodb')
    })
  })

  describe('Database integration types with SSL support', () => {
    it('should contain all SQL integration types that support SSL', () => {
      expect(databaseIntegrationTypesWithSslSupport).toContain('clickhouse')
      expect(databaseIntegrationTypesWithSslSupport).toContain('dremio')
      expect(databaseIntegrationTypesWithSslSupport).toContain('mariadb')
      expect(databaseIntegrationTypesWithSslSupport).toContain('mindsdb')
      expect(databaseIntegrationTypesWithSslSupport).toContain('mongodb')
      expect(databaseIntegrationTypesWithSslSupport).toContain('mysql')
      expect(databaseIntegrationTypesWithSslSupport).toContain('pgsql')
      expect(databaseIntegrationTypesWithSslSupport).toContain('redshift')
      expect(databaseIntegrationTypesWithSslSupport).toContain('trino')
    })
  })
})
