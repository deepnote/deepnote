import fs from 'node:fs/promises'
import path from 'node:path'
import type { ZodSchema } from 'zod/v3'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { integrationsFileSchema } from '../src/integrations/integrations-file-schemas'

async function run() {
  const jsonSchema = zodToJsonSchema(integrationsFileSchema as unknown as ZodSchema)
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
