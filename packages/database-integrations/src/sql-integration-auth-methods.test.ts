import { describe, expect, it } from 'vitest'
import {
  BigQueryAuthMethods,
  DatabaseAuthMethods,
  federatedAuthMethods,
  isFederatedAuthMetadata,
  isFederatedAuthMethod,
  SnowflakeAuthMethods,
} from './sql-integration-auth-methods'

describe('Auth methods', () => {
  describe('Federated auth method list', () => {
    it('should list Snowflake federated auth methods between federated auth methods', () => {
      expect(federatedAuthMethods).toContain(SnowflakeAuthMethods.Okta)
      expect(federatedAuthMethods).toContain(SnowflakeAuthMethods.NativeSnowflake)
      expect(federatedAuthMethods).toContain(SnowflakeAuthMethods.AzureAd)
      expect(federatedAuthMethods).toContain(SnowflakeAuthMethods.KeyPair)
    })

    it('should not list Snowflake non-federated auth methods between federated auth methods', () => {
      expect(federatedAuthMethods).not.toContain(SnowflakeAuthMethods.Password)
      expect(federatedAuthMethods).not.toContain(SnowflakeAuthMethods.ServiceAccountKeyPair)
    })

    it('should list BigQuery federated auth methods between federated auth methods', () => {
      expect(federatedAuthMethods).toContain(BigQueryAuthMethods.GoogleOauth)
    })

    it('should not list BigQuery non-federated auth methods between federated auth methods', () => {
      expect(federatedAuthMethods).not.toContain(BigQueryAuthMethods.ServiceAccount)
    })

    it('should list generic database federated auth methods between federated auth methods', () => {
      expect(federatedAuthMethods).toContain(DatabaseAuthMethods.IndividualCredentials)
    })

    it('should not list generic database non-federated auth methods between federated auth methods', () => {
      expect(federatedAuthMethods).not.toContain(DatabaseAuthMethods.UsernameAndPassword)
    })
  })

  describe('Federated auth method check', () => {
    it('should claim all Snowflake federated auth methods is federated', () => {
      expect(isFederatedAuthMethod(SnowflakeAuthMethods.Okta)).toBe(true)
      expect(isFederatedAuthMethod(SnowflakeAuthMethods.NativeSnowflake)).toBe(true)
      expect(isFederatedAuthMethod(SnowflakeAuthMethods.AzureAd)).toBe(true)
      expect(isFederatedAuthMethod(SnowflakeAuthMethods.KeyPair)).toBe(true)
    })

    it('should not claim any Snowflake non-federated auth methods is federated', () => {
      expect(isFederatedAuthMethod(SnowflakeAuthMethods.Password)).toBe(false)
      expect(isFederatedAuthMethod(SnowflakeAuthMethods.ServiceAccountKeyPair)).toBe(false)
    })

    it('should claim all BigQuery federated auth methods is federated', () => {
      expect(isFederatedAuthMethod(BigQueryAuthMethods.GoogleOauth)).toBe(true)
    })

    it('should not claim any BigQuery non-federated auth methods is federated', () => {
      expect(isFederatedAuthMethod(BigQueryAuthMethods.ServiceAccount)).toBe(false)
    })

    it('should claim all generic database federated auth methods is federated', () => {
      expect(isFederatedAuthMethod(DatabaseAuthMethods.IndividualCredentials)).toBe(true)
    })

    it('should not claim any generic database non-federated auth methods is federated', () => {
      expect(isFederatedAuthMethod(DatabaseAuthMethods.UsernameAndPassword)).toBe(false)
    })
  })

  describe('Federated auth metadata check', () => {
    it('should claim metadata with any Snowflake federated auth method is federated', () => {
      expect(isFederatedAuthMetadata({ authMethod: SnowflakeAuthMethods.Okta })).toBe(true)
      expect(isFederatedAuthMetadata({ authMethod: SnowflakeAuthMethods.NativeSnowflake })).toBe(true)
      expect(isFederatedAuthMetadata({ authMethod: SnowflakeAuthMethods.AzureAd })).toBe(true)
      expect(isFederatedAuthMetadata({ authMethod: SnowflakeAuthMethods.KeyPair })).toBe(true)
    })

    it('should not claim metadata with any Snowflake non-federated auth methods is federated', () => {
      expect(isFederatedAuthMetadata({ authMethod: SnowflakeAuthMethods.Password })).toBe(false)
      expect(isFederatedAuthMetadata({ authMethod: SnowflakeAuthMethods.ServiceAccountKeyPair })).toBe(false)
    })

    it('should claim metadata with any BigQuery federated auth methods is federated', () => {
      expect(isFederatedAuthMetadata({ authMethod: BigQueryAuthMethods.GoogleOauth })).toBe(true)
    })

    it('should not claim metadata with any BigQuery non-federated auth methods is federated', () => {
      expect(isFederatedAuthMetadata({ authMethod: BigQueryAuthMethods.ServiceAccount })).toBe(false)
    })

    it('should claim metadata with any generic database federated auth methods is federated', () => {
      expect(isFederatedAuthMetadata({ authMethod: DatabaseAuthMethods.IndividualCredentials })).toBe(true)
    })

    it('should not claim metadata with any generic database non-federated auth methods is federated', () => {
      expect(isFederatedAuthMetadata({ authMethod: DatabaseAuthMethods.UsernameAndPassword })).toBe(false)
    })
  })
})
