import type {
  DatabaseIntegrationConfig,
  DatabaseIntegrationMetadataByType,
  SnowflakeAuthMethod,
} from '@deepnote/database-integrations'
import { SnowflakeAuthMethods } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import {
  promptForOptionalSecretField,
  promptForOptionalStringField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
} from '../../../utils/inquirer'
import { assertNever } from '../../../utils/typescript'

type SnowflakeMetadata = DatabaseIntegrationMetadataByType['snowflake']

type SnowflakePasswordMetadata = Extract<SnowflakeMetadata, { authMethod?: typeof SnowflakeAuthMethods.Password }>
type SnowflakeOktaMetadata = Extract<SnowflakeMetadata, { authMethod: typeof SnowflakeAuthMethods.Okta }>
type SnowflakeNativeMetadata = Extract<SnowflakeMetadata, { authMethod: typeof SnowflakeAuthMethods.NativeSnowflake }>
type SnowflakeAzureAdMetadata = Extract<SnowflakeMetadata, { authMethod: typeof SnowflakeAuthMethods.AzureAd }>
type SnowflakeKeyPairMetadata = Extract<SnowflakeMetadata, { authMethod: typeof SnowflakeAuthMethods.KeyPair }>
type SnowflakeServiceAccountKeyPairMetadata = Extract<
  SnowflakeMetadata,
  { authMethod: typeof SnowflakeAuthMethods.ServiceAccountKeyPair }
>

type CommonSnowflakeKeys =
  | 'accountName'
  | 'warehouse'
  | 'database'
  | 'role'
  | 'dbt'
  | 'dbtServiceToken'
  | 'dbtPrimaryJobId'
  | 'dbtProxyServerUrl'
type SnowflakeAuthFields<T extends SnowflakeMetadata> = Omit<T, CommonSnowflakeKeys>

async function promptForPasswordAuth(
  defaultValues?: SnowflakePasswordMetadata
): Promise<SnowflakeAuthFields<SnowflakePasswordMetadata>> {
  const username = await promptForRequiredStringField({
    label: 'Username:',
    defaultValue: defaultValues?.username,
  })
  const password = await promptForRequiredSecretField({
    label: 'Password:',
    defaultValue: defaultValues?.password,
  })
  return { authMethod: SnowflakeAuthMethods.Password, username, password }
}

async function promptForOktaAuth(
  defaultValues?: SnowflakeOktaMetadata
): Promise<SnowflakeAuthFields<SnowflakeOktaMetadata>> {
  const clientId = await promptForRequiredStringField({
    label: 'Client ID:',
    defaultValue: defaultValues?.clientId,
  })
  const clientSecret = await promptForRequiredSecretField({
    label: 'Client Secret:',
    defaultValue: defaultValues?.clientSecret,
  })
  const oktaSubdomain = await promptForRequiredStringField({
    label: 'Okta Subdomain:',
    defaultValue: defaultValues?.oktaSubdomain,
  })
  const identityProvider = await promptForRequiredStringField({
    label: 'Identity Provider:',
    defaultValue: defaultValues?.identityProvider,
  })
  const authorizationServer = await promptForRequiredStringField({
    label: 'Authorization Server:',
    defaultValue: defaultValues?.authorizationServer,
  })
  return {
    authMethod: SnowflakeAuthMethods.Okta,
    clientId,
    clientSecret,
    oktaSubdomain,
    identityProvider,
    authorizationServer,
  }
}

async function promptForNativeSnowflakeAuth(
  defaultValues?: SnowflakeNativeMetadata
): Promise<SnowflakeAuthFields<SnowflakeNativeMetadata>> {
  const clientId = await promptForRequiredStringField({
    label: 'Client ID:',
    defaultValue: defaultValues?.clientId,
  })
  const clientSecret = await promptForRequiredSecretField({
    label: 'Client Secret:',
    defaultValue: defaultValues?.clientSecret,
  })
  return { authMethod: SnowflakeAuthMethods.NativeSnowflake, clientId, clientSecret }
}

async function promptForAzureAdAuth(
  defaultValues?: SnowflakeAzureAdMetadata
): Promise<SnowflakeAuthFields<SnowflakeAzureAdMetadata>> {
  const clientId = await promptForRequiredStringField({
    label: 'Client ID:',
    defaultValue: defaultValues?.clientId,
  })
  const clientSecret = await promptForRequiredSecretField({
    label: 'Client Secret:',
    defaultValue: defaultValues?.clientSecret,
  })
  const resource = await promptForRequiredStringField({
    label: 'Resource:',
    defaultValue: defaultValues?.resource,
  })
  const tenant = await promptForRequiredStringField({
    label: 'Tenant:',
    defaultValue: defaultValues?.tenant,
  })
  return { authMethod: SnowflakeAuthMethods.AzureAd, clientId, clientSecret, resource, tenant }
}

async function promptForServiceAccountKeyPairAuth(
  defaultValues?: SnowflakeServiceAccountKeyPairMetadata
): Promise<SnowflakeAuthFields<SnowflakeServiceAccountKeyPairMetadata>> {
  const username = await promptForRequiredStringField({
    label: 'Service Account Username:',
    defaultValue: defaultValues?.username,
  })
  const privateKey = await promptForRequiredSecretField({
    label: 'Private Key (PEM):',
    defaultValue: defaultValues?.privateKey,
  })
  const privateKeyPassphrase = await promptForOptionalSecretField({
    label: 'Private Key Passphrase:',
    defaultValue: defaultValues?.privateKeyPassphrase,
  })
  return {
    authMethod: SnowflakeAuthMethods.ServiceAccountKeyPair,
    username,
    privateKey,
    ...(privateKeyPassphrase ? { privateKeyPassphrase } : {}),
  }
}

function isMatchingDefaultValues<T extends SnowflakeMetadata>(
  defaultValues: SnowflakeMetadata | undefined,
  authMethod: T['authMethod']
): defaultValues is T {
  if (!defaultValues) {
    return false
  }
  const currentMethod = defaultValues.authMethod ?? SnowflakeAuthMethods.Password
  return currentMethod === authMethod
}

type SnowflakeAuthFieldsUnion =
  | SnowflakeAuthFields<SnowflakePasswordMetadata>
  | SnowflakeAuthFields<SnowflakeOktaMetadata>
  | SnowflakeAuthFields<SnowflakeNativeMetadata>
  | SnowflakeAuthFields<SnowflakeAzureAdMetadata>
  | SnowflakeAuthFields<SnowflakeKeyPairMetadata>
  | SnowflakeAuthFields<SnowflakeServiceAccountKeyPairMetadata>

async function promptForAuthFields(
  authMethod: SnowflakeAuthMethod,
  defaultValues?: SnowflakeMetadata
): Promise<SnowflakeAuthFieldsUnion> {
  switch (authMethod) {
    case SnowflakeAuthMethods.Password:
      return promptForPasswordAuth(
        isMatchingDefaultValues<SnowflakePasswordMetadata>(defaultValues, authMethod) ? defaultValues : undefined
      )
    case SnowflakeAuthMethods.Okta:
      return promptForOktaAuth(
        isMatchingDefaultValues<SnowflakeOktaMetadata>(defaultValues, authMethod) ? defaultValues : undefined
      )
    case SnowflakeAuthMethods.NativeSnowflake:
      return promptForNativeSnowflakeAuth(
        isMatchingDefaultValues<SnowflakeNativeMetadata>(defaultValues, authMethod) ? defaultValues : undefined
      )
    case SnowflakeAuthMethods.AzureAd:
      return promptForAzureAdAuth(
        isMatchingDefaultValues<SnowflakeAzureAdMetadata>(defaultValues, authMethod) ? defaultValues : undefined
      )
    case SnowflakeAuthMethods.KeyPair:
      return { authMethod: SnowflakeAuthMethods.KeyPair } satisfies SnowflakeAuthFields<SnowflakeKeyPairMetadata>
    case SnowflakeAuthMethods.ServiceAccountKeyPair:
      return promptForServiceAccountKeyPairAuth(
        isMatchingDefaultValues<SnowflakeServiceAccountKeyPairMetadata>(defaultValues, authMethod)
          ? defaultValues
          : undefined
      )
    default:
      return assertNever(authMethod)
  }
}

export async function promptForFieldsSnowflake({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'snowflake'
  name: string
  defaultValues?: SnowflakeMetadata
}): Promise<DatabaseIntegrationConfig> {
  const accountName = await promptForRequiredStringField({
    label: 'Account Name:',
    defaultValue: defaultValues?.accountName,
  })

  const currentAuthMethod =
    defaultValues && 'authMethod' in defaultValues && defaultValues.authMethod
      ? defaultValues.authMethod
      : SnowflakeAuthMethods.Password

  const authMethod = await select({
    message: 'Authentication method:',
    default: currentAuthMethod,
    choices: [
      { name: 'Password', value: SnowflakeAuthMethods.Password },
      { name: 'Okta', value: SnowflakeAuthMethods.Okta },
      { name: 'Native Snowflake OAuth', value: SnowflakeAuthMethods.NativeSnowflake },
      { name: 'Azure AD', value: SnowflakeAuthMethods.AzureAd },
      { name: 'Key Pair', value: SnowflakeAuthMethods.KeyPair },
      { name: 'Service Account Key Pair', value: SnowflakeAuthMethods.ServiceAccountKeyPair },
    ],
  })

  const authMetadata = await promptForAuthFields(authMethod, defaultValues)

  const warehouse = await promptForOptionalStringField({
    label: 'Warehouse:',
    defaultValue: defaultValues?.warehouse,
  })
  const database = await promptForOptionalStringField({
    label: 'Database:',
    defaultValue: defaultValues?.database,
  })
  const role = await promptForOptionalStringField({
    label: 'Role:',
    defaultValue: defaultValues?.role,
  })

  const metadata = {
    accountName,
    ...authMetadata,
    ...(warehouse ? { warehouse } : {}),
    ...(database ? { database } : {}),
    ...(role ? { role } : {}),
  }

  return {
    id,
    type,
    name,
    metadata,
  }
}
