import type { DatabaseIntegrationConfig, DatabaseIntegrationMetadataByType } from '@deepnote/database-integrations'
import {
  promptForOptionalStringField,
  promptForRequiredSecretField,
  promptForRequiredStringField,
} from '../../../utils/inquirer'

export async function promptForFieldsAthena({
  id,
  type,
  name,
  defaultValues,
}: {
  id: string
  type: 'athena'
  name: string
  defaultValues?: DatabaseIntegrationMetadataByType['athena']
}): Promise<DatabaseIntegrationConfig> {
  const region = await promptForRequiredStringField({ label: 'Region:', defaultValue: defaultValues?.region })
  const s3_output_path = await promptForRequiredStringField({
    label: 'S3 Output Path:',
    defaultValue: defaultValues?.s3_output_path,
  })
  const access_key_id = await promptForRequiredStringField({
    label: 'Access Key ID:',
    defaultValue: defaultValues?.access_key_id,
  })
  const secret_access_key = await promptForRequiredSecretField({
    label: 'Secret Access Key:',
    defaultValue: defaultValues?.secret_access_key,
  })
  const workgroup = await promptForOptionalStringField({
    label: 'Workgroup:',
    defaultValue: defaultValues?.workgroup,
  })

  const metadata: DatabaseIntegrationMetadataByType['athena'] = {
    region,
    s3_output_path,
    access_key_id,
    secret_access_key,
    ...(workgroup ? { workgroup } : {}),
  }

  return {
    id,
    type,
    name,
    metadata,
  }
}
