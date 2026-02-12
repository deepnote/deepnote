import fs from 'node:fs/promises'
import path from 'node:path'
import type { ZodTypeAny } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { integrationsFileSchema } from '../src/integrations/integrations-file-schemas'

async function run() {
  // biome-ignore lint/suspicious/noTsIgnore: Type instantiation is excessively deep and possibly infinite.
  // @ts-ignore
  const zodToJsonSchemaUnsafe: (schema: ZodTypeAny) => unknown = zodToJsonSchema
  const jsonSchema = zodToJsonSchemaUnsafe(integrationsFileSchema)
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
