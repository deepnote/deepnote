import fs from 'node:fs/promises'
import path from 'node:path'
import { integrationsFileSchema } from '../src/integrations/integrations-file-schemas'

async function run() {
  // Dynamic import avoids tsc resolving zod-to-json-schema's deeply nested generics
  const { zodToJsonSchema } = (await import('zod-to-json-schema')) as { zodToJsonSchema: (schema: unknown) => unknown }
  const jsonSchema = zodToJsonSchema(integrationsFileSchema)
  await fs.writeFile(path.join('json-schemas', 'integrations-file-schema.json'), JSON.stringify(jsonSchema, null, 2))
}

run()
  .then(() => {
    console.log('Done')
    process.exit(0)
  })
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
