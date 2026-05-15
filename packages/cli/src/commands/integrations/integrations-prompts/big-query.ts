import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import { BigQueryAuthMethods } from '@deepnote/database-integrations'
import { select } from '@inquirer/prompts'
import { promptForRequiredSecretField, promptForRequiredStringField } from '../../../utils/inquirer'

export async function promptForFieldsBigQuery({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'big-query'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['big-query']
}): Promise<DatabaseIntegrationConfig> {
  const currentAuthMethod =
    defaultValues && 'authMethod' in defaultValues && defaultValues.authMethod
      ? defaultValues.authMethod
      : BigQueryAuthMethods.ServiceAccount

  const authMethod = await select({
    message: 'Authentication method:',
    default: currentAuthMethod,
    choices: [
      { name: 'Service Account', value: BigQueryAuthMethods.ServiceAccount },
      { name: 'Google OAuth', value: BigQueryAuthMethods.GoogleOauth },
    ],
  })

  let metadata: DatabaseIntegrationMetadataByType['big-query']

  if (authMethod === BigQueryAuthMethods.ServiceAccount) {
    const service_account = await promptForRequiredSecretField({
      label: 'Service Account (JSON):',
      defaultValue: defaultValues && 'service_account' in defaultValues ? defaultValues.service_account : undefined,
    })

    metadata = {
      authMethod: BigQueryAuthMethods.ServiceAccount,
      service_account,
    }
  } else {
    const project = await promptForRequiredStringField({
      label: 'Google Project ID:',
      defaultValue: defaultValues && 'project' in defaultValues ? defaultValues.project : undefined,
    })
    const clientId = await promptForRequiredStringField({
      label: 'Client ID:',
      defaultValue: defaultValues && 'clientId' in defaultValues ? defaultValues.clientId : undefined,
    })
    const clientSecret = await promptForRequiredSecretField({
      label: 'Client Secret:',
      defaultValue: defaultValues && 'clientSecret' in defaultValues ? defaultValues.clientSecret : undefined,
    })

    metadata = {
      authMethod: BigQueryAuthMethods.GoogleOauth,
      project,
      clientId,
      clientSecret,
    }
  }

  return {
    id,
    type,
    name,
    metadata,
  }
}
