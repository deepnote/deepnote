import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForBooleanField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
} from '../../../utils/inquirer'

export async function promptForFieldsSpanner({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'spanner'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['spanner']
}): Promise<DatabaseIntegrationConfig> {
  const instance = await promptForRequiredStringField({ label: 'Instance:', defaultValue: defaultValues?.instance })
  const database = await promptForRequiredStringField({ label: 'Database:', defaultValue: defaultValues?.database })
  const dataBoostEnabled = await promptForBooleanField({
    label: 'Enable Data Boost:',
    defaultValue: defaultValues?.dataBoostEnabled ?? false,
  })
  const service_account = await promptForRequiredSecretField({
    label: 'Service Account (JSON):',
    defaultValue: defaultValues?.service_account,
  })

  const metadata: DatabaseIntegrationMetadataByType['spanner'] = {
    instance,
    database,
    dataBoostEnabled,
    service_account,
  }

  return {
    id,
    type,
    name,
    metadata,
  }
}
