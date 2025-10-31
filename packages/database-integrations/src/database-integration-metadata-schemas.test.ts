import { describe, expect, it } from 'vitest'
import { databaseMetadataSchemasByType } from './database-integration-metadata-schemas'

describe('SQL integration metadata schemas', () => {
  describe('Athena', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['athena'].safeParse({
        access_key_id: 'my-access-key-id',
        region: 'my-region',
        s3_output_path: 'my-s3-output-path',
        secret_access_key: 'my-secret-access-key',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        access_key_id: 'my-access-key-id',
        region: 'my-region',
        s3_output_path: 'my-s3-output-path',
        secret_access_key: 'my-secret-access-key',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['athena'].safeParse({
        access_key_id: 'my-access-key-id',
        region: 'my-region',
        s3_output_path: 'my-s3-output-path',
        secret_access_key: 'my-secret-access-key',
        workgroup: 'my-workgroup',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        access_key_id: 'my-access-key-id',
        region: 'my-region',
        s3_output_path: 'my-s3-output-path',
        secret_access_key: 'my-secret-access-key',
        workgroup: 'my-workgroup',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['athena'].safeParse({
        access_key_id: 'my-access-key-id',
        region: 'my-region',
        secret_access_key: 'my-secret-access-key',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('BigQuery', () => {
    it('should validate valid metadata with service account', () => {
      const result = databaseMetadataSchemasByType['big-query'].safeParse({
        authMethod: 'service-account',
        service_account: 'my-service-account',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'service-account',
        service_account: 'my-service-account',
      })
    })

    it('should validate valid metadata with google oauth', () => {
      const result = databaseMetadataSchemasByType['big-query'].safeParse({
        authMethod: 'google-oauth',
        project: 'my-project',
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'google-oauth',
        project: 'my-project',
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
      })
    })

    it('should fail on metadata with auth method field missing', () => {
      const result = databaseMetadataSchemasByType['big-query'].safeParse({
        service_account: 'my-service-account',
      })

      expect(result.success).toBe(false)
    })

    it('should fail on metadata with null auth method', () => {
      const result = databaseMetadataSchemasByType['big-query'].safeParse({
        authMethod: null,
        service_account: 'my-service-account',
      })

      expect(result.success).toBe(false)
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['big-query'].safeParse({
        authMethod: 'service-account',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('ClickHouse', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['clickhouse'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['clickhouse'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['clickhouse'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('Databricks', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['databricks'].safeParse({
        host: 'my-host',
        httpPath: 'my-http-path',
        token: 'my-token',
        port: 'my-port',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        httpPath: 'my-http-path',
        token: 'my-token',
        port: 'my-port',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['databricks'].safeParse({
        host: 'my-host',
        httpPath: 'my-http-path',
        token: 'my-token',
        port: 'my-port',
        schema: 'my-schema',
        catalog: 'my-catalog',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        httpPath: 'my-http-path',
        token: 'my-token',
        port: 'my-port',
        schema: 'my-schema',
        catalog: 'my-catalog',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['databricks'].safeParse({
        host: 'my-host',
        httpPath: 'my-http-path',
        token: 'my-token',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('Dremio', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['dremio'].safeParse({
        schema: 'my-schema',
        host: 'my-host',
        port: 'my-port',
        token: 'my-token',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        schema: 'my-schema',
        host: 'my-host',
        port: 'my-port',
        token: 'my-token',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['dremio'].safeParse({
        schema: 'my-schema',
        host: 'my-host',
        port: 'my-port',
        token: 'my-token',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        schema: 'my-schema',
        host: 'my-host',
        port: 'my-port',
        token: 'my-token',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['dremio'].safeParse({
        schema: 'my-schema',
        host: 'my-host',
        port: 'my-port',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('MongoDB', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['mongodb'].safeParse({
        connection_string: 'my-connection-string',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        connection_string: 'my-connection-string',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['mongodb'].safeParse({
        connection_string: 'my-connection-string',
        rawConnectionString: 'my-raw-connection-string',
        prefix: 'my-prefix',
        host: 'my-host',
        port: 'my-port',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        options: 'my-options',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        connection_string: 'my-connection-string',
        rawConnectionString: 'my-raw-connection-string',
        prefix: 'my-prefix',
        host: 'my-host',
        port: 'my-port',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        options: 'my-options',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['mongodb'].safeParse({
        host: 'my-host',
        port: 'my-port',
        user: 'my-user',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('Redshift', () => {
    it('should validate valid metadata with username and password', () => {
      const result = databaseMetadataSchemasByType['redshift'].safeParse({
        authMethod: 'username-and-password',
        database: 'my-database',
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'username-and-password',
        database: 'my-database',
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
      })
    })

    it('should validate valid metadata with iam role', () => {
      const result = databaseMetadataSchemasByType['redshift'].safeParse({
        authMethod: 'iam-role',
        database: 'my-database',
        host: 'my-host',
        roleArn: 'my-role-arn',
        roleExternalId: 'my-role-external-id',
        roleNonce: 'my-role-nonce',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'iam-role',
        database: 'my-database',
        host: 'my-host',
        roleArn: 'my-role-arn',
        roleExternalId: 'my-role-external-id',
        roleNonce: 'my-role-nonce',
      })
    })

    it('should validate valid metadata with individual credentials', () => {
      const result = databaseMetadataSchemasByType['redshift'].safeParse({
        authMethod: 'individual-credentials',
        database: 'my-database',
        host: 'my-host',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'individual-credentials',
        database: 'my-database',
        host: 'my-host',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['redshift'].safeParse({
        authMethod: 'username-and-password',
        database: 'my-database',
        host: 'my-host',
      })

      expect(result.success).toBe(false)
    })

    it('should fail on metadata with null auth method', () => {
      const result = databaseMetadataSchemasByType['redshift'].safeParse({
        authMethod: null,
        database: 'my-database',
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
      })

      expect(result.success).toBe(false)
    })

    it('should fail on metadata with invalid auth method', () => {
      const result = databaseMetadataSchemasByType['redshift'].safeParse({
        authMethod: 'invalid-auth-method',
        database: 'my-database',
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
      })

      expect(result.success).toBe(false)
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['redshift'].safeParse({
        authMethod: 'username-and-password',
        database: 'my-database',
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        port: 'my-port',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'username-and-password',
        database: 'my-database',
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        port: 'my-port',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })
    })
  })

  describe('Snowflake', () => {
    it('should validate valid metadata with password', () => {
      const result = databaseMetadataSchemasByType['snowflake'].safeParse({
        authMethod: 'password',
        accountName: 'my-account-name',
        username: 'my-username',
        password: 'my-password',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'password',
        accountName: 'my-account-name',
        username: 'my-username',
        password: 'my-password',
      })
    })

    it('should validate valid metadata with okta', () => {
      const result = databaseMetadataSchemasByType['snowflake'].safeParse({
        authMethod: 'okta',
        accountName: 'my-account-name',
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
        oktaSubdomain: 'my-okta-subdomain',
        identityProvider: 'my-identity-provider',
        authorizationServer: 'my-authorization-server',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'okta',
        accountName: 'my-account-name',
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
        oktaSubdomain: 'my-okta-subdomain',
        identityProvider: 'my-identity-provider',
        authorizationServer: 'my-authorization-server',
      })
    })

    it('should validate valid metadata with snowflake oauth', () => {
      const result = databaseMetadataSchemasByType['snowflake'].safeParse({
        authMethod: 'snowflake',
        accountName: 'my-account-name',
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'snowflake',
        accountName: 'my-account-name',
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
      })
    })

    it('should validate valid metadata with key pair', () => {
      const result = databaseMetadataSchemasByType['snowflake'].safeParse({
        authMethod: 'key-pair',
        accountName: 'my-account-name',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'key-pair',
        accountName: 'my-account-name',
      })
    })

    it('should validate valid metadata with service account key pair', () => {
      const result = databaseMetadataSchemasByType['snowflake'].safeParse({
        authMethod: 'service-account-key-pair',
        accountName: 'my-account-name',
        username: 'my-username',
        privateKey: 'my-private-key',
        privateKeyPassphrase: 'my-private-key-passphrase',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        authMethod: 'service-account-key-pair',
        accountName: 'my-account-name',
        username: 'my-username',
        privateKey: 'my-private-key',
        privateKeyPassphrase: 'my-private-key-passphrase',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['snowflake'].safeParse({
        authMethod: 'password',
        accountName: 'my-account-name',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('Spanner', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['spanner'].safeParse({
        service_account: 'my-service-account',
        dataBoostEnabled: true,
        instance: 'my-instance',
        database: 'my-database',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        service_account: 'my-service-account',
        dataBoostEnabled: true,
        instance: 'my-instance',
        database: 'my-database',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['spanner'].safeParse({
        dataBoostEnabled: true,
      })

      expect(result.success).toBe(false)
    })
  })

  describe('Trino', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['trino'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['trino'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        sshEnabled: true,
        sshHost: 'my-ssh-host',
        sshPort: 'my-ssh-port',
        sshUser: 'my-ssh-user',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['trino'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('AlloyDB', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['alloydb'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['alloydb'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['alloydb'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('MariaDB', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['mariadb'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['mariadb'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        caCertificateName: 'my-ca-certificate-name',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        caCertificateName: 'my-ca-certificate-name',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['mariadb'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('MindsDB', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['mindsdb'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['mindsdb'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        caCertificateName: 'my-ca-certificate-name',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        caCertificateName: 'my-ca-certificate-name',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['mindsdb'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('MySQL', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['mysql'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['mysql'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        caCertificateName: 'my-ca-certificate-name',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        caCertificateName: 'my-ca-certificate-name',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['mysql'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('PostgreSQL', () => {
    it('should validate valid metadata', () => {
      const result = databaseMetadataSchemasByType['pgsql'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
      })
    })

    it('should validate valid metadata with optional fields', () => {
      const result = databaseMetadataSchemasByType['pgsql'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })

      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
        database: 'my-database',
        port: 'my-port',
        sslEnabled: true,
        caCertificateName: 'my-ca-certificate-name',
        caCertificateText: 'my-ca-certificate-text',
      })
    })

    it('should fail on metadata with missing fields', () => {
      const result = databaseMetadataSchemasByType['pgsql'].safeParse({
        host: 'my-host',
        user: 'my-user',
        password: 'my-password',
      })

      expect(result.success).toBe(false)
    })
  })
})
