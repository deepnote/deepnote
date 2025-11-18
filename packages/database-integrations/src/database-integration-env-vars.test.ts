import { describe, expect, it } from 'vitest'
import {
  BigQueryServiceAccountParseError,
  getEnvironmentVariablesForIntegrations,
  getSqlEnvVarName,
  SpannerServiceAccountParseError,
} from './database-integration-env-vars'

describe('Database integration env variables', () => {
  const getSqlAlchemyInputVar = (envVars: Array<{ name: string; value: string }>, integrationId: string) => {
    const json = envVars.find(envVar => envVar.name === getSqlEnvVarName(integrationId))?.value
    return json ? JSON.parse(json) : undefined
  }

  describe('getEnvironmentVariablesForIntegrations', () => {
    describe('AlloyDB', () => {
      it('should generate a SQL Alchemy env var with postgresql URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'alloydb',
              id: 'my-alloydb',
              name: 'My AlloyDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-alloydb')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-alloydb',
          url: 'postgresql://my-user:my-password@my-host/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with postgresql URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'alloydb',
              id: 'my-alloydb',
              name: 'My AlloyDB Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-alloydb')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-alloydb',
          url: 'postgresql://my-user:my-password@my-host:5432/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })

      it('should include sslmode=verify-ca if a CA certificate is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'alloydb',
              id: 'my-alloydb',
              name: 'My AlloyDB Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                caCertificateName: 'my-ca-certificate-name',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-alloydb')
        expect(sqlAlchemyInput.params.connect_args.sslmode).toBe('verify-ca')
        expect(sqlAlchemyInput.params.connect_args.sslrootcert).toBe(
          '/path/to/project/.deepnote/my-alloydb/my-ca-certificate-name'
        )
      })

      it('should include sslmode=require if SSL is enabled but no CA is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'alloydb',
              id: 'my-alloydb',
              name: 'My AlloyDB Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sslEnabled: true,
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-alloydb')
        expect(sqlAlchemyInput.params.connect_args.sslmode).toBe('require')
      })

      it('should not default the port in the URL if not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'alloydb',
              id: 'my-alloydb',
              name: 'My AlloyDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-alloydb')
        expect(sqlAlchemyInput.url).toBe('postgresql://my-user:my-password@my-host/my-database')
      })

      it('should exclude caCertificateText from env vars', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'alloydb',
              id: 'my-alloydb',
              name: 'My AlloyDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                caCertificateName: 'my-ca-certificate-name',
                caCertificateText: 'my-ca-certificate-text',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        // Verify that caCertificateText is not in the env vars
        const caCertTextEnvVar = envVars.find(envVar => envVar.name === 'MY_ALLOYDB_CONNECTION_CACERTIFICATETEXT')
        expect(caCertTextEnvVar).toBeUndefined()

        // Verify that caCertificateName is still included
        const caCertNameEnvVar = envVars.find(envVar => envVar.name === 'MY_ALLOYDB_CONNECTION_CACERTIFICATENAME')
        expect(caCertNameEnvVar).toBeDefined()
        expect(caCertNameEnvVar?.value).toBe('my-ca-certificate-name')

        // Verify that the SQL Alchemy input uses the path, not the text
        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-alloydb')
        expect(sqlAlchemyInput.params.connect_args.sslrootcert).toBe(
          '/path/to/project/.deepnote/my-alloydb/my-ca-certificate-name'
        )
      })

      it('should generate env vars for metadata', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'alloydb',
              id: 'my-alloydb',
              name: 'My AlloyDB Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_ALLOYDB_CONNECTION_HOST',
          value: 'my-host',
        })
        expect(envVars).toContainEqual({
          name: 'MY_ALLOYDB_CONNECTION_PORT',
          value: '5432',
        })
        expect(envVars).toContainEqual({
          name: 'MY_ALLOYDB_CONNECTION_USER',
          value: 'my-user',
        })
        expect(envVars).toContainEqual({
          name: 'MY_ALLOYDB_CONNECTION_PASSWORD',
          value: 'my-password',
        })
        expect(envVars).toContainEqual({
          name: 'MY_ALLOYDB_CONNECTION_DATABASE',
          value: 'my-database',
        })
      })
    })

    describe('Athena', () => {
      it('should generate a SQL Alchemy env var with awsathena+rest URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'athena',
              id: 'my-athena',
              name: 'My Athena Connection',
              metadata: {
                access_key_id: 'my-access-key-id',
                region: 'my-region',
                s3_output_path: 'my-s3-output-path',
                secret_access_key: 'my-secret-access-key',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-athena')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-athena',
          url: 'awsathena+rest://my-access-key-id:my-secret-access-key@athena.my-region.amazonaws.com:443/?s3_staging_dir=my-s3-output-path',
          params: expect.anything(),
          param_style: 'pyformat',
        })
      })

      it('should generate a SQL Alchemy env var with awsathena+rest URL and workgroup', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'athena',
              id: 'my-athena',
              name: 'My Athena Connection',
              metadata: {
                access_key_id: 'my-access-key-id',
                region: 'my-region',
                s3_output_path: 'my-s3-output-path',
                secret_access_key: 'my-secret-access-key',
                workgroup: 'my-workgroup',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-athena')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-athena',
          url: 'awsathena+rest://my-access-key-id:my-secret-access-key@athena.my-region.amazonaws.com:443/?s3_staging_dir=my-s3-output-path&work_group=my-workgroup',
          params: expect.anything(),
          param_style: 'pyformat',
        })
      })

      it('should generate env vars for metadata', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'athena',
              id: 'my-athena',
              name: 'My Athena Connection',
              metadata: {
                access_key_id: 'my-access-key-id',
                region: 'my-region',
                s3_output_path: 'my-s3-output-path',
                secret_access_key: 'my-secret-access-key',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_ATHENA_CONNECTION_ACCESS_KEY_ID',
          value: 'my-access-key-id',
        })
        expect(envVars).toContainEqual({
          name: 'MY_ATHENA_CONNECTION_REGION',
          value: 'my-region',
        })
        expect(envVars).toContainEqual({
          name: 'MY_ATHENA_CONNECTION_S3_OUTPUT_PATH',
          value: 'my-s3-output-path',
        })
        expect(envVars).toContainEqual({
          name: 'MY_ATHENA_CONNECTION_SECRET_ACCESS_KEY',
          value: 'my-secret-access-key',
        })
      })
    })

    describe('BigQuery', () => {
      it('should generate a SQL Alchemy env var with bigquery URL for service account', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'big-query',
              id: 'my-big-query',
              name: 'My BigQuery Connection',
              metadata: {
                authMethod: 'service-account',
                service_account: JSON.stringify({
                  type: 'service_account',
                  project_id: 'my-project-id',
                  private_key_id: 'my-private-key-id',
                  private_key: 'my-private-key',
                  client_email: 'my-client-email',
                  client_id: 'my-client-id',
                  auth_uri: 'my-auth-uri',
                  token_uri: 'my-token-uri',
                  auth_provider_x509_cert_url: 'my-auth-provider-x509-cert-url',
                  client_x509_cert_url: 'my-client-x509-cert-url',
                }),
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-big-query')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-big-query',
          url: 'bigquery://',
          params: {
            credentials_info: {
              type: 'service_account',
              project_id: 'my-project-id',
              private_key_id: 'my-private-key-id',
              private_key: 'my-private-key',
              client_email: 'my-client-email',
              client_id: 'my-client-id',
              auth_uri: 'my-auth-uri',
              token_uri: 'my-token-uri',
              auth_provider_x509_cert_url: 'my-auth-provider-x509-cert-url',
              client_x509_cert_url: 'my-client-x509-cert-url',
            },
          },
          param_style: 'pyformat',
        })
      })

      it('should generate a SQL Alchemy env var with bigquery URL for service account even when federated_auth_method is set to service-account', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'big-query',
              id: 'my-big-query',
              name: 'My BigQuery Connection',
              federated_auth_method: 'service-account',
              metadata: {
                authMethod: 'service-account',
                service_account: JSON.stringify({
                  type: 'service_account',
                  project_id: 'my-project-id',
                  private_key_id: 'my-private-key-id',
                  private_key: 'my-private-key',
                  client_email: 'my-client-email',
                  client_id: 'my-client-id',
                  auth_uri: 'my-auth-uri',
                  token_uri: 'my-token-uri',
                  auth_provider_x509_cert_url: 'my-auth-provider-x509-cert-url',
                  client_x509_cert_url: 'my-client-x509-cert-url',
                }),
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-big-query')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-big-query',
          url: 'bigquery://',
          params: {
            credentials_info: {
              type: 'service_account',
              project_id: 'my-project-id',
              private_key_id: 'my-private-key-id',
              private_key: 'my-private-key',
              client_email: 'my-client-email',
              client_id: 'my-client-id',
              auth_uri: 'my-auth-uri',
              token_uri: 'my-token-uri',
              auth_provider_x509_cert_url: 'my-auth-provider-x509-cert-url',
              client_x509_cert_url: 'my-client-x509-cert-url',
            },
          },
          param_style: 'pyformat',
        })
      })

      it('should return an error if service account is not valid JSON', () => {
        const { errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'big-query',
              id: 'my-big-query',
              name: 'My BigQuery Connection',
              metadata: {
                authMethod: 'service-account',
                service_account: 'not-valid-json',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )

        expect(errors).toHaveLength(1)
        expect(errors[0]).toBeInstanceOf(BigQueryServiceAccountParseError)
      })

      it('should generate a SQL Alchemy env var for legacy service account', () => {
        const metadata = {
          service_account: JSON.stringify({
            type: 'service_account',
            project_id: 'test-project-id',
            private_key_id: 'private-key-id',
            private_key: '-----BEGIN PRIVATE KEY-----\n\n-----END PRIVATE KEY-----\n',
            client_email: 'test-email@example.com',
            client_id: 'client-id',
            auth_uri: 'https://accounts.google.com/o/oauth2/auth',
            token_uri: 'https://oauth2.googleapis.com/token',
            auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
            client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/test-email%40example.com',
          }),
        }

        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'big-query',
              id: 'my-big-query',
              name: 'My BigQuery Connection',
              metadata,
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-big-query')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-big-query',
          url: 'bigquery://',
          params: {
            credentials_info: JSON.parse(metadata.service_account),
          },
          param_style: 'pyformat',
        })
      })

      it('should not generate a SQL Alchemy env var for google oauth', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'big-query',
              id: 'my-big-query',
              name: 'My BigQuery Connection',
              metadata: {
                authMethod: 'google-oauth',
                project: 'my-project',
                clientId: 'my-client-id',
                clientSecret: 'my-client-secret',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-big-query')
        expect(sqlAlchemyInput).toBeUndefined()
      })
    })

    describe('ClickHouse', () => {
      it('should generate a SQL Alchemy env var with clickhouse URL and SSL disabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'clickhouse',
              id: 'my-clickhouse',
              name: 'My ClickHouse Connection',
              metadata: {
                host: 'my-host',
                port: '8123',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-clickhouse')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-clickhouse',
          url: 'clickhouse://my-user:my-password@my-host:8123/my-database?protocol=https',
          params: {},
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with clickhouse URL and SSL enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'clickhouse',
              id: 'my-clickhouse',
              name: 'My ClickHouse Connection',
              metadata: {
                host: 'my-host',
                port: '8123',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sslEnabled: true,
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-clickhouse')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-clickhouse',
          url: 'clickhouse://my-user:my-password@my-host:8123/my-database?protocol=https&secure=true&tls_mode=strict',
          params: {},
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should not default the port in clickhouse URL when not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'clickhouse',
              id: 'my-clickhouse',
              name: 'My ClickHouse Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-clickhouse')
        expect(sqlAlchemyInput.url).toBe('clickhouse://my-user:my-password@my-host/my-database?protocol=https')
      })

      it('should allow missing password', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'clickhouse',
              id: 'my-clickhouse',
              name: 'My ClickHouse Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-clickhouse')
        expect(sqlAlchemyInput.url).toBe('clickhouse://my-user@my-host/my-database?protocol=https')
      })

      it('should request CA certificate verification when CA certificate is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'clickhouse',
              id: 'my-clickhouse',
              name: 'My ClickHouse Connection',
              metadata: {
                host: 'my-host',
                port: '8123',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sslEnabled: true,
                caCertificateName: 'my-ca-certificate-name',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-clickhouse')
        expect(sqlAlchemyInput.url).toBe(
          `clickhouse://my-user:my-password@my-host:8123/my-database?protocol=https&secure=true&tls_mode=strict&verify=${encodeURIComponent(
            '/path/to/project/.deepnote/my-clickhouse/my-ca-certificate-name'
          )}`
        )
      })

      it('should generate a SQL Alchemy env var with clickhouse URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'clickhouse',
              id: 'my-clickhouse',
              name: 'My ClickHouse Connection',
              metadata: {
                host: 'my-host',
                port: '8123',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-clickhouse')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-clickhouse',
          url: 'clickhouse://my-user:my-password@my-host:8123/my-database?protocol=https',
          params: {},
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })
    })

    describe('Databricks', () => {
      it('should generate a SQL Alchemy env var with databricks+connector URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'databricks',
              id: 'my-databricks',
              name: 'My Databricks Connection',
              metadata: {
                host: 'my-host',
                httpPath: 'my-http-path',
                token: 'my-token',
                port: 'my-port',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-databricks')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-databricks',
          url: 'databricks+connector://token:my-token@my-host:my-port',
          params: {
            connect_args: {
              http_path: 'my-http-path',
            },
          },
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with databricks+connector URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'databricks',
              id: 'my-databricks',
              name: 'My Databricks Connection',
              metadata: {
                host: 'my-host',
                httpPath: 'my-http-path',
                token: 'my-token',
                port: 'my-port',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-databricks')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-databricks',
          url: 'databricks+connector://token:my-token@my-host:my-port',
          params: {
            connect_args: {
              http_path: 'my-http-path',
            },
          },
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })
    })

    describe('Dremio', () => {
      it('should generate a SQL Alchemy env var with dremio+flight URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'dremio',
              id: 'my-dremio',
              name: 'My Dremio Connection',
              metadata: {
                schema: 'my-schema',
                host: 'my-host',
                port: '32010',
                token: 'my-token',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-dremio')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-dremio',
          url: 'dremio+flight://my-host:32010/my-schema?UseEncryption=true&Token=my-token',
          params: {},
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with dremio+flight URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'dremio',
              id: 'my-dremio',
              name: 'My Dremio Connection',
              metadata: {
                schema: 'my-schema',
                host: 'my-host',
                port: '32010',
                token: 'my-token',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-dremio')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-dremio',
          url: 'dremio+flight://my-host:32010/my-schema?UseEncryption=true&Token=my-token',
          params: {},
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })

      it('should generate env vars for metadata', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'dremio',
              id: 'my-dremio',
              name: 'My Dremio Connection',
              metadata: {
                schema: 'my-schema',
                host: 'my-host',
                port: '32010',
                token: 'my-token',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_DREMIO_CONNECTION_SCHEMA',
          value: 'my-schema',
        })
        expect(envVars).toContainEqual({
          name: 'MY_DREMIO_CONNECTION_HOST',
          value: 'my-host',
        })
        expect(envVars).toContainEqual({
          name: 'MY_DREMIO_CONNECTION_PORT',
          value: '32010',
        })
        expect(envVars).toContainEqual({
          name: 'MY_DREMIO_CONNECTION_TOKEN',
          value: 'my-token',
        })
      })
    })

    describe('MariaDB', () => {
      it('should generate a SQL Alchemy env var with mysql+pymysql URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mariadb',
              id: 'my-mariadb',
              name: 'My MariaDB Connection',
              metadata: {
                host: 'my-host',
                port: '3306',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mariadb')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mariadb',
          url: 'mysql+pymysql://my-user:my-password@my-host:3306/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with mysql+pymysql URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mariadb',
              id: 'my-mariadb',
              name: 'My MariaDB Connection',
              metadata: {
                host: 'my-host',
                port: '3306',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mariadb')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mariadb',
          url: 'mysql+pymysql://my-user:my-password@my-host:3306/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })

      it('should generate a SQL Alchemy env var with mysql+pymysql URL and a CA', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mariadb',
              id: 'my-mariadb',
              name: 'My MariaDB Connection',
              metadata: {
                host: 'my-host',
                port: '3306',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                caCertificateName: 'my-ca-certificate-name',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mariadb')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mariadb',
          url: 'mysql+pymysql://my-user:my-password@my-host:3306/my-database',
          params: {
            connect_args: {
              ssl: {
                ca: '/path/to/project/.deepnote/my-mariadb/my-ca-certificate-name',
                check_hostname: false,
              },
            },
          },
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with mysql+pymysql URL and SSL enabled when CA is not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mariadb',
              id: 'my-mariadb',
              name: 'My MariaDB Connection',
              metadata: {
                host: 'my-host',
                port: '3306',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mariadb')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mariadb',
          url: 'mysql+pymysql://my-user:my-password@my-host:3306/my-database',
          params: {
            connect_args: {
              ssl: {
                enable: true,
              },
            },
          },
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should not default the port in the URL if not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mariadb',
              id: 'my-mariadb',
              name: 'My MariaDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mariadb')
        expect(sqlAlchemyInput.url).toBe('mysql+pymysql://my-user:my-password@my-host/my-database')
      })

      it('should generate env vars for metadata', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mariadb',
              id: 'my-mariadb',
              name: 'My MariaDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_MARIADB_CONNECTION_HOST',
          value: 'my-host',
        })
        expect(envVars).toContainEqual({
          name: 'MY_MARIADB_CONNECTION_USER',
          value: 'my-user',
        })
        expect(envVars).toContainEqual({
          name: 'MY_MARIADB_CONNECTION_PASSWORD',
          value: 'my-password',
        })
        expect(envVars).toContainEqual({
          name: 'MY_MARIADB_CONNECTION_DATABASE',
          value: 'my-database',
        })
      })
    })

    describe('MindsDB', () => {
      it('should generate a SQL Alchemy env var with mysql+pymysql URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mindsdb',
              id: 'my-mindsdb',
              name: 'My MindsDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mindsdb')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mindsdb',
          url: 'mysql+pymysql://my-user:my-password@my-host/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with mysql+pymysql URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mindsdb',
              id: 'my-mindsdb',
              name: 'My MindsDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mindsdb')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mindsdb',
          url: 'mysql+pymysql://my-user:my-password@my-host/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })

      it('should generate a SQL Alchemy env var with mysql+pymysql URL and a CA', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mindsdb',
              id: 'my-mindsdb',
              name: 'My MindsDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                caCertificateName: 'my-ca-certificate-name',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mindsdb')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mindsdb',
          url: 'mysql+pymysql://my-user:my-password@my-host/my-database',
          params: {
            connect_args: {
              ssl: {
                ca: '/path/to/project/.deepnote/my-mindsdb/my-ca-certificate-name',
                check_hostname: false,
              },
            },
          },
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with mysql+pymysql URL and SSL enabled when CA is not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mindsdb',
              id: 'my-mindsdb',
              name: 'My MindsDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mindsdb')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mindsdb',
          url: 'mysql+pymysql://my-user:my-password@my-host/my-database',
          params: {
            connect_args: {
              ssl: {
                enable: true,
              },
            },
          },
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should not default the port in the URL if not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mindsdb',
              id: 'my-mindsdb',
              name: 'My MindsDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mindsdb')
        expect(sqlAlchemyInput.url).toBe('mysql+pymysql://my-user:my-password@my-host/my-database')
      })

      it('should generate env vars for metadata', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mindsdb',
              id: 'my-mindsdb',
              name: 'My MindsDB Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_MINDSDB_CONNECTION_HOST',
          value: 'my-host',
        })
        expect(envVars).toContainEqual({
          name: 'MY_MINDSDB_CONNECTION_USER',
          value: 'my-user',
        })
        expect(envVars).toContainEqual({
          name: 'MY_MINDSDB_CONNECTION_PASSWORD',
          value: 'my-password',
        })
        expect(envVars).toContainEqual({
          name: 'MY_MINDSDB_CONNECTION_DATABASE',
          value: 'my-database',
        })
      })
    })

    describe('MySQL', () => {
      it('should generate a SQL Alchemy env var with mysql+pymysql URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mysql',
              id: 'my-mysql',
              name: 'My MySQL Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mysql')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mysql',
          url: 'mysql+pymysql://my-user:my-password@my-host/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with mysql+pymysql URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mysql',
              id: 'my-mysql',
              name: 'My MySQL Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mysql')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mysql',
          url: 'mysql+pymysql://my-user:my-password@my-host/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })

      it('should generate a SQL Alchemy env var with mysql+pymysql URL and a CA', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mysql',
              id: 'my-mysql',
              name: 'My MySQL Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                caCertificateName: 'my-ca-certificate-name',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mysql')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mysql',
          url: 'mysql+pymysql://my-user:my-password@my-host/my-database',
          params: {
            connect_args: {
              ssl: {
                ca: '/path/to/project/.deepnote/my-mysql/my-ca-certificate-name',
                check_hostname: false,
              },
            },
          },
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with mysql+pymysql URL and SSL enabled when CA is not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mysql',
              id: 'my-mysql',
              name: 'My MySQL Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mysql')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-mysql',
          url: 'mysql+pymysql://my-user:my-password@my-host/my-database',
          params: {
            connect_args: {
              ssl: {
                enable: true,
              },
            },
          },
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should not default the port in the URL if not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mysql',
              id: 'my-mysql',
              name: 'My MySQL Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mysql')
        expect(sqlAlchemyInput.url).toBe('mysql+pymysql://my-user:my-password@my-host/my-database')
      })

      it('should exclude caCertificateText from env vars', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mysql',
              id: 'my-mysql',
              name: 'My MySQL Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                caCertificateName: 'my-ca-certificate-name',
                caCertificateText: 'my-ca-certificate-text',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        // Verify that caCertificateText is not in the env vars
        const caCertTextEnvVar = envVars.find(envVar => envVar.name === 'MY_MYSQL_CONNECTION_CACERTIFICATETEXT')
        expect(caCertTextEnvVar).toBeUndefined()

        // Verify that caCertificateName is still included
        const caCertNameEnvVar = envVars.find(envVar => envVar.name === 'MY_MYSQL_CONNECTION_CACERTIFICATENAME')
        expect(caCertNameEnvVar).toBeDefined()
        expect(caCertNameEnvVar?.value).toBe('my-ca-certificate-name')

        // Verify that the SQL Alchemy input uses the path, not the text
        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mysql')
        expect(sqlAlchemyInput.params.connect_args.ssl.ca).toBe(
          '/path/to/project/.deepnote/my-mysql/my-ca-certificate-name'
        )
      })

      it('should generate env vars for metadata', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mysql',
              id: 'my-mysql',
              name: 'My MySQL Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_MYSQL_CONNECTION_HOST',
          value: 'my-host',
        })
        expect(envVars).toContainEqual({
          name: 'MY_MYSQL_CONNECTION_USER',
          value: 'my-user',
        })
        expect(envVars).toContainEqual({
          name: 'MY_MYSQL_CONNECTION_PASSWORD',
          value: 'my-password',
        })
        expect(envVars).toContainEqual({
          name: 'MY_MYSQL_CONNECTION_DATABASE',
          value: 'my-database',
        })
      })
    })

    describe('Materialize', () => {
      it('should generate a SQL Alchemy env var with postgres URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'materialize',
              id: 'my-materialize',
              name: 'My Materialize Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                cluster: 'my-cluster',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-materialize')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-materialize',
          url: 'postgresql://my-user:my-password@my-host:5432/my-database?options=--cluster%3Dmy-cluster',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with postgres URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'materialize',
              id: 'my-materialize',
              name: 'My Materialize Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                cluster: 'my-cluster',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-materialize')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-materialize',
          url: 'postgresql://my-user:my-password@my-host:5432/my-database?options=--cluster%3Dmy-cluster',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })

      it('should generate a SQL Alchemy env var with postgres URL and a CA', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'materialize',
              id: 'my-materialize',
              name: 'My Materialize Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                cluster: 'my-cluster',
                caCertificateName: 'my-ca-certificate-name',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-materialize')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-materialize',
          url: 'postgresql://my-user:my-password@my-host:5432/my-database?options=--cluster%3Dmy-cluster',
          params: {
            connect_args: {
              sslmode: 'verify-ca',
              sslrootcert: '/path/to/project/.deepnote/my-materialize/my-ca-certificate-name',
            },
          },
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should not default the port in the URL if not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'materialize',
              id: 'my-materialize',
              name: 'My Materialize Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                cluster: 'my-cluster',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-materialize')
        expect(sqlAlchemyInput.url).toBe(
          'postgresql://my-user:my-password@my-host/my-database?options=--cluster%3Dmy-cluster'
        )
      })
    })

    describe('Pandas DataFrame SQL', () => {
      it('should generate a SQL Alchemy env var with DuckDB URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'pandas-dataframe',
              id: 'my-pandas-dataframe',
              name: 'My Pandas DataFrame',
              metadata: {},
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-pandas-dataframe')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-pandas-dataframe',
          url: 'deepnote+duckdb:///:memory:',
          params: {},
          param_style: 'qmark',
        })
      })
    })

    describe('PostgreSQL', () => {
      it('should generate a SQL Alchemy env var with postgresql URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'pgsql',
              id: 'my-postgres',
              name: 'My PostgreSQL Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-postgres')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-postgres',
          url: 'postgresql://my-user:my-password@my-host:5432/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with postgresql URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'pgsql',
              id: 'my-postgres',
              name: 'My PostgreSQL Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-postgres')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-postgres',
          url: 'postgresql://my-user:my-password@my-host:5432/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })

      it('should include sslmode=verify-ca if a CA certificate is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'pgsql',
              id: 'my-postgres',
              name: 'My PostgreSQL Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                caCertificateName: 'my-ca-certificate-name',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-postgres')
        expect(sqlAlchemyInput.params.connect_args.sslmode).toBe('verify-ca')
        expect(sqlAlchemyInput.params.connect_args.sslrootcert).toBe(
          '/path/to/project/.deepnote/my-postgres/my-ca-certificate-name'
        )
      })

      it('should include sslmode=require if SSL is enabled but no CA is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'pgsql',
              id: 'my-postgres',
              name: 'My PostgreSQL Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sslEnabled: true,
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-postgres')
        expect(sqlAlchemyInput.params.connect_args.sslmode).toBe('require')
      })

      it('should not default the port in the URL if not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'pgsql',
              id: 'my-postgres',
              name: 'My PostgreSQL Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-postgres')
        expect(sqlAlchemyInput.url).toBe('postgresql://my-user:my-password@my-host/my-database')
      })

      it('should exclude caCertificateText from env vars', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'pgsql',
              id: 'my-postgres',
              name: 'My PostgreSQL Connection',
              metadata: {
                host: 'my-host',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                caCertificateName: 'my-ca-certificate-name',
                caCertificateText: 'my-ca-certificate-text',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        // Verify that caCertificateText is not in the env vars
        const caCertTextEnvVar = envVars.find(envVar => envVar.name === 'MY_POSTGRESQL_CONNECTION_CACERTIFICATETEXT')
        expect(caCertTextEnvVar).toBeUndefined()

        // Verify that caCertificateName is still included
        const caCertNameEnvVar = envVars.find(envVar => envVar.name === 'MY_POSTGRESQL_CONNECTION_CACERTIFICATENAME')
        expect(caCertNameEnvVar).toBeDefined()
        expect(caCertNameEnvVar?.value).toBe('my-ca-certificate-name')

        // Verify that the SQL Alchemy input uses the path, not the text
        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-postgres')
        expect(sqlAlchemyInput.params.connect_args.sslrootcert).toBe(
          '/path/to/project/.deepnote/my-postgres/my-ca-certificate-name'
        )
      })

      it('should generate env vars for metadata', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'pgsql',
              id: 'my-postgres',
              name: 'My PostgreSQL Connection',
              metadata: {
                host: 'my-host',
                port: '5432',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_POSTGRESQL_CONNECTION_HOST',
          value: 'my-host',
        })
        expect(envVars).toContainEqual({
          name: 'MY_POSTGRESQL_CONNECTION_PORT',
          value: '5432',
        })
        expect(envVars).toContainEqual({
          name: 'MY_POSTGRESQL_CONNECTION_USER',
          value: 'my-user',
        })
        expect(envVars).toContainEqual({
          name: 'MY_POSTGRESQL_CONNECTION_PASSWORD',
          value: 'my-password',
        })
        expect(envVars).toContainEqual({
          name: 'MY_POSTGRESQL_CONNECTION_DATABASE',
          value: 'my-database',
        })
      })
    })

    describe('Redshift', () => {
      it('should generate a SQL Alchemy env var with redshift+psycopg2 URL for username and password', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'redshift',
              id: 'my-redshift',
              name: 'My Redshift Connection',
              metadata: {
                authMethod: 'username-and-password',
                host: 'my-host',
                port: '5439',
                database: 'my-database',
                user: 'my-user',
                password: 'my-password',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-redshift',
          url: 'redshift+psycopg2://my-user:my-password@my-host:5439/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with redshift+psycopg2 URL for username and password even when federated_auth_method is set to username-and-password', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'redshift',
              id: 'my-redshift',
              name: 'My Redshift Connection',
              federated_auth_method: 'username-and-password',
              metadata: {
                authMethod: 'username-and-password',
                host: 'my-host',
                port: '5439',
                database: 'my-database',
                user: 'my-user',
                password: 'my-password',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-redshift',
          url: 'redshift+psycopg2://my-user:my-password@my-host:5439/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with redshift+psycopg2 URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'redshift',
              id: 'my-redshift',
              name: 'My Redshift Connection',
              metadata: {
                authMethod: 'username-and-password',
                host: 'my-host',
                port: '5439',
                database: 'my-database',
                user: 'my-user',
                password: 'my-password',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-redshift',
          url: 'redshift+psycopg2://my-user:my-password@my-host:5439/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })

      it('should generate a SQL Alchemy env var with redshift+psycopg2 URL and IAM params for IAM role', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'redshift',
              id: 'my-redshift',
              name: 'My Redshift Connection',
              metadata: {
                authMethod: 'iam-role',
                host: 'my-host',
                port: '5439',
                database: 'my-database',
                roleArn: 'my-role-arn',
                roleExternalId: 'my-role-external-id',
                roleNonce: 'my-role-nonce',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-redshift',
          url: 'redshift+psycopg2://my-host:5439/my-database',
          params: expect.anything(),
          param_style: 'pyformat',
          ssh_options: {},
          iamParams: {
            integrationId: 'my-redshift',
            type: 'redshift',
          },
        })
      })

      it('should not generate a SQL Alchemy env var for individual credentials', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'redshift',
              id: 'my-redshift',
              name: 'My Redshift Connection',
              metadata: {
                authMethod: 'individual-credentials',
                host: 'my-host',
                port: '5439',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput).toBeUndefined()
      })

      it('should include keepalives in connect arguments', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'redshift',
              id: 'my-redshift',
              name: 'My Redshift Connection',
              metadata: {
                authMethod: 'username-and-password',
                host: 'my-host',
                port: '5439',
                database: 'my-database',
                user: 'my-user',
                password: 'my-password',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput.params.connect_args.keepalives).toBe(1)
        expect(sqlAlchemyInput.params.connect_args.keepalives_idle).toBe(30)
        expect(sqlAlchemyInput.params.connect_args.keepalives_interval).toBe(10)
        expect(sqlAlchemyInput.params.connect_args.keepalives_count).toBe(5)
      })

      it('should include SSL mode and certificate path in connect arguments if CA is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'redshift',
              id: 'my-redshift',
              name: 'My Redshift Connection',
              metadata: {
                authMethod: 'username-and-password',
                host: 'my-host',
                port: '5439',
                database: 'my-database',
                user: 'my-user',
                password: 'my-password',
                caCertificateName: 'my-ca-certificate-name',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput.params.connect_args.sslmode).toBe('verify-ca')
        expect(sqlAlchemyInput.params.connect_args.sslrootcert).toBe(
          '/path/to/project/.deepnote/my-redshift/my-ca-certificate-name'
        )
      })

      it('should set sslmode to "require" if SSL is enabled but no CA is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'redshift',
              id: 'my-redshift',
              name: 'My Redshift Connection',
              metadata: {
                authMethod: 'username-and-password',
                host: 'my-host',
                port: '5439',
                database: 'my-database',
                user: 'my-user',
                password: 'my-password',
                sslEnabled: true,
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput.params.connect_args.sslmode).toBe('require')
      })

      it('should set sslmode to "prefer" if SSL is not enabled and no CA is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'redshift',
              id: 'my-redshift',
              name: 'My Redshift Connection',
              metadata: {
                authMethod: 'username-and-password',
                host: 'my-host',
                port: '5439',
                database: 'my-database',
                user: 'my-user',
                password: 'my-password',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput.params.connect_args.sslmode).toBe('prefer')
      })

      it('should not default the port in the URL if not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'redshift',
              id: 'my-redshift',
              name: 'My Redshift Connection',
              metadata: {
                authMethod: 'username-and-password',
                host: 'my-host',
                database: 'my-database',
                user: 'my-user',
                password: 'my-password',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput.url).toBe('redshift+psycopg2://my-user:my-password@my-host/my-database')
      })

      it('should support legacy integrations without authMethod', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              'id': 'my-redshift',
              'name': 'Amazon Redshift',
              'type': 'redshift',
              'metadata': {
                'database': 'my-database',
                'host': 'my-host',
                'port': 'my-port',
                'sshEnabled': false,
                'user': 'my-user',
                'password': 'my-password',
              },
              'federated_auth_method': null,
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-redshift')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-redshift',
          url: 'redshift+psycopg2://my-user:my-password@my-host:my-port/my-database',
          params: expect.any(Object),
          param_style: 'pyformat',
          ssh_options: {},
        })
      })
    })

    describe('Spanner', () => {
      it('should generate a SQL Alchemy env var with spanner URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'spanner',
              id: 'my-spanner',
              name: 'My Spanner Connection',
              metadata: {
                service_account: '{"project_id": "my-project-id"}',
                dataBoostEnabled: true,
                instance: 'my-instance',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-spanner')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-spanner',
          url: 'spanner+spanner:///projects/my-project-id/instances/my-instance/databases/my-database',
          params: {},
          param_style: 'pyformat',
        })
      })

      it('should return an error if the service account is invalid', () => {
        const { errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'spanner',
              id: 'my-spanner',
              name: 'My Spanner Connection',
              metadata: {
                service_account: 'invalid',
                dataBoostEnabled: true,
                instance: 'my-instance',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )

        expect(errors).toHaveLength(1)
        expect(errors[0]).toBeInstanceOf(SpannerServiceAccountParseError)
      })

      it('should return an error if the service account is missing project_id', () => {
        const { errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'spanner',
              id: 'my-spanner',
              name: 'My Spanner Connection',
              metadata: {
                service_account: '{}',
                dataBoostEnabled: true,
                instance: 'my-instance',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )

        expect(errors).toHaveLength(1)
        expect(errors[0]).toBeInstanceOf(SpannerServiceAccountParseError)
      })
    })

    describe('Snowflake', () => {
      it('should generate a SQL Alchemy env var with snowflake URL for password auth', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'snowflake',
              id: 'my-snowflake',
              name: 'My Snowflake Connection',
              metadata: {
                authMethod: 'password',
                accountName: 'my-account-name',
                username: 'my-username',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-snowflake')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-snowflake',
          url: 'snowflake://my-username:my-password@my-account-name/my-database',
          params: {},
          param_style: 'pyformat',
        })
      })

      it('should generate a SQL Alchemy env var with snowflake URL for password auth even when federated_auth_method is set to password', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'snowflake',
              id: 'my-snowflake',
              name: 'My Snowflake Connection',
              federated_auth_method: 'password',
              metadata: {
                authMethod: 'password',
                accountName: 'my-account-name',
                username: 'my-username',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-snowflake')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-snowflake',
          url: 'snowflake://my-username:my-password@my-account-name/my-database',
          params: {},
          param_style: 'pyformat',
        })
      })

      it('should not generate a SQL Alchemy env var with snowflake URL for key pair auth', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'snowflake',
              id: 'my-snowflake',
              name: 'My Snowflake Connection',
              metadata: {
                authMethod: 'key-pair',
                accountName: 'my-account-name',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-snowflake')
        expect(sqlAlchemyInput).toBeUndefined()
      })

      it('should generate a SQL Alchemy env var with snowflake URL for service account key pair auth', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'snowflake',
              id: 'my-snowflake',
              name: 'My Snowflake Connection',
              metadata: {
                authMethod: 'service-account-key-pair',
                accountName: 'my-account-name',
                username: 'my-username',
                privateKey: 'my-private-key',
                privateKeyPassphrase: 'my-private-key-passphrase',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-snowflake')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-snowflake',
          url: 'snowflake://my-username@my-account-name/my-database?authenticator=snowflake_jwt',
          params: {
            snowflake_private_key: btoa('my-private-key'),
            snowflake_private_key_passphrase: 'my-private-key-passphrase',
          },
          param_style: 'pyformat',
        })
      })

      it('should generate a SQL Alchemy env var with snowflake URL for service account key pair auth without passphrase', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'snowflake',
              id: 'my-snowflake',
              name: 'My Snowflake Connection',
              metadata: {
                authMethod: 'service-account-key-pair',
                accountName: 'my-account-name',
                username: 'my-username',
                privateKey: 'my-private-key',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-snowflake')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-snowflake',
          url: 'snowflake://my-username@my-account-name/my-database?authenticator=snowflake_jwt',
          params: {
            snowflake_private_key: btoa('my-private-key'),
          },
          param_style: 'pyformat',
        })
      })

      it('should generate a SQL Alchemy env var with snowflake URL for service account key pair auth with role', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'snowflake',
              id: 'my-snowflake',
              name: 'My Snowflake Connection',
              metadata: {
                authMethod: 'service-account-key-pair',
                accountName: 'my-account-name',
                username: 'my-username',
                privateKey: 'my-private-key',
                database: 'my-database',
                role: 'my-role',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-snowflake')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-snowflake',
          url: 'snowflake://my-username@my-account-name/my-database?role=my-role&authenticator=snowflake_jwt',
          params: {
            snowflake_private_key: btoa('my-private-key'),
          },
          param_style: 'pyformat',
        })
      })
    })

    describe('SQL Server', () => {
      it('should generate a SQL Alchemy env var with mssql+pymssql URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'sql-server',
              id: 'my-sql-server',
              name: 'My SQL Server Connection',
              metadata: {
                host: 'my-host',
                port: '1433',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-sql-server')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-sql-server',
          url: 'mssql+pymssql://my-user:my-password@my-host:1433/my-database',
          params: {},
          param_style: 'pyformat',
          ssh_options: {},
        })
      })

      it('should generate a SQL Alchemy env var with mssql+pymssql URL and SSH enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'sql-server',
              id: 'my-sql-server',
              name: 'My SQL Server Connection',
              metadata: {
                host: 'my-host',
                port: '1433',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sshEnabled: true,
                sshHost: 'my-ssh-host',
                sshPort: '255',
                sshUser: 'my-ssh-user',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-sql-server')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-sql-server',
          url: 'mssql+pymssql://my-user:my-password@my-host:1433/my-database',
          params: {},
          param_style: 'pyformat',
          ssh_options: {
            enabled: true,
            host: 'my-ssh-host',
            port: '255',
            user: 'my-ssh-user',
          },
        })
      })

      it('should not default the port in the URL if not provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'sql-server',
              id: 'my-sql-server',
              name: 'My SQL Server Connection',
              metadata: {
                host: 'my-host',
                port: '',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-sql-server')
        expect(sqlAlchemyInput.url).toBe('mssql+pymssql://my-user:my-password@my-host/my-database')
      })
    })

    describe('Trino', () => {
      it('should generate a SQL Alchemy env var with trino URL', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'trino',
              id: 'my-trino',
              name: 'My Trino Connection',
              metadata: {
                authMethod: 'password',
                host: 'my-host',
                port: '8080',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-trino')
        expect(sqlAlchemyInput).toStrictEqual({
          integration_id: 'my-trino',
          url: 'trino://my-user:my-password@my-host:8080/my-database',
          params: {
            connect_args: {},
          },
          param_style: 'qmark',
        })
      })

      it('should set http_scheme to https if SSL is enabled', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'trino',
              id: 'my-trino',
              name: 'My Trino Connection',
              metadata: {
                authMethod: 'password',
                host: 'my-host',
                port: '8080',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                sslEnabled: true,
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-trino')
        expect(sqlAlchemyInput.params.connect_args.http_scheme).toBe('https')
      })

      it('should set verify to the CA certificate path if a CA certificate is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'trino',
              id: 'my-trino',
              name: 'My Trino Connection',
              metadata: {
                authMethod: 'password',
                host: 'my-host',
                port: '8080',
                user: 'my-user',
                password: 'my-password',
                database: 'my-database',
                caCertificateName: 'my-ca-certificate-name',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-trino')
        expect(sqlAlchemyInput.params.connect_args.verify).toBe(
          '/path/to/project/.deepnote/my-trino/my-ca-certificate-name'
        )
      })
    })

    describe('MongoDB', () => {
      it('should not generate a SQL Alchemy env var', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mongodb',
              id: 'my-mongodb',
              name: 'My MongoDB Database',
              metadata: {
                connection_string: 'my-connection-string',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-mongodb')
        expect(sqlAlchemyInput).toBeUndefined()
      })

      it('should generate a connection string env var', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mongodb',
              id: 'my-mongodb',
              name: 'My MongoDB Database',
              metadata: {
                connection_string: 'my-connection-string',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_MONGODB_DATABASE_CONNECTION_STRING',
          value: 'my-connection-string',
        })
      })

      it('should add SSL options to the connection string if SSL is enabled and a CA certificate is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mongodb',
              id: 'my-mongodb',
              name: 'My MongoDB Database',
              metadata: {
                connection_string: 'my-connection-string',
                sslEnabled: true,
                caCertificateName: 'my-ca-certificate-name',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_MONGODB_DATABASE_CONNECTION_STRING',
          value: `my-connection-string?tls=true&tlsCAFile=${encodeURIComponent(
            '/path/to/project/.deepnote/my-mongodb/my-ca-certificate-name'
          )}`,
        })
      })

      it('should not add SSL options to the connection string if SSL is enabled but no CA is provided', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'mongodb',
              id: 'my-mongodb',
              name: 'My MongoDB Database',
              metadata: {
                connection_string: 'my-connection-string',
                sslEnabled: true,
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_MONGODB_DATABASE_CONNECTION_STRING',
          value: 'my-connection-string?tls=true',
        })
      })
    })

    describe('top-level federated auth method', () => {
      it('should not generate a SQL Alchemy env var for an integration with top-level federated auth method', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'big-query',
              id: 'my-big-query',
              name: 'My BigQuery Connection',
              federated_auth_method: 'google-oauth',
              metadata: {
                authMethod: 'service-account',
                service_account: 'my-service-account',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-big-query')
        expect(sqlAlchemyInput).toBeUndefined()
      })

      it('should generate env vars for metadata for an integration with top-level federated auth method', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'big-query',
              id: 'my-big-query',
              name: 'My BigQuery Connection',
              federated_auth_method: 'google-oauth',
              metadata: {
                authMethod: 'service-account',
                service_account: '{}',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'MY_BIGQUERY_CONNECTION_SERVICE_ACCOUNT',
          value: '{}',
        })
      })
    })

    describe('edge cases with integration names', () => {
      it('should prefix metadata env vars with _ when the name starts with a number', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'big-query',
              id: 'my-big-query',
              name: '1 My BigQuery Connection',
              metadata: {
                authMethod: 'service-account',
                service_account: '{}',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: '_1_MY_BIGQUERY_CONNECTION_SERVICE_ACCOUNT',
          value: '{}',
        })
      })

      it('should replace non-alphanumeric characters with _ in metadata env vars', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'big-query',
              id: 'my-big-query',
              name: 'Special @ name with # chars',
              metadata: {
                authMethod: 'service-account',
                service_account: '{}',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: 'SPECIAL___NAME_WITH___CHARS_SERVICE_ACCOUNT',
          value: '{}',
        })
      })

      it('should not trim whitespace characters in metadata env vars', () => {
        const { envVars, errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              type: 'big-query',
              id: 'my-big-query',
              name: ' Name with space and new line \n',
              metadata: {
                authMethod: 'service-account',
                service_account: '{}',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(0)

        expect(envVars).toContainEqual({
          name: '_NAME_WITH_SPACE_AND_NEW_LINE___SERVICE_ACCOUNT',
          value: '{}',
        })
      })
    })

    describe('unknown integration type', () => {
      it('should return an error', () => {
        const { errors } = getEnvironmentVariablesForIntegrations(
          [
            {
              // @ts-expect-error we are testing the unknown type
              type: 'unknown',
              id: 'my-unknown',
              name: 'My Unknown Connection',
              metadata: {},
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )
        expect(errors).toHaveLength(1)
        expect(errors[0]).toBeInstanceOf(Error)
        expect(errors[0].message).toBe('Unexpected value: [object Object]')
      })

      it('should generate env vars for metadata', () => {
        const { envVars } = getEnvironmentVariablesForIntegrations(
          [
            {
              // @ts-expect-error we are testing the unknown type
              type: 'unknown',
              id: 'my-unknown',
              name: 'My Unknown Connection',
              metadata: {
                test: 'my-test',
              },
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )

        expect(envVars).toContainEqual({
          name: 'MY_UNKNOWN_CONNECTION_TEST',
          value: 'my-test',
        })
      })

      it('should not generate a SQL Alchemy env var', () => {
        const { envVars } = getEnvironmentVariablesForIntegrations(
          [
            {
              // @ts-expect-error we are testing the unknown type
              type: 'unknown',
              id: 'my-unknown',
              name: 'My Unknown Connection',
              metadata: {},
            },
          ],
          { projectRootDirectory: '/path/to/project' }
        )

        const sqlAlchemyInput = getSqlAlchemyInputVar(envVars, 'my-unknown')
        expect(sqlAlchemyInput).toBeUndefined()
      })
    })
  })
})
