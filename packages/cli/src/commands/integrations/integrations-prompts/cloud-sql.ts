import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import { promptForRequiredSecretField } from '../../../utils/inquirer'

export async function promptForFieldsCloudSql({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'cloud-sql'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['cloud-sql']
}): Promise<DatabaseIntegrationConfig> {
  const service_account = await promptForRequiredSecretField({
    label: 'Service Account (JSON):',
    defaultValue: defaultValues?.service_account,
  })

  const metadata: DatabaseIntegrationMetadataByType['cloud-sql'] = {
    service_account,
  }

  return {
    id,
    type,
    name,
    metadata,
  }
}
