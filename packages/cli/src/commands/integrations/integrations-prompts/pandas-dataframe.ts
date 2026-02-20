import type { DatabaseIntegrationConfig } from '@deepnote/database-integrations'

export async function promptForFieldsPandasDataframe({
  id,
  type,
  name,
}: {
  id: string
  type: 'pandas-dataframe'
  name: string
}): Promise<DatabaseIntegrationConfig> {
  return {
    id,
    type,
    name,
    metadata: {},
  }
}
