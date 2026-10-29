import fs from 'node:fs/promises'
import path from 'node:path'
import { integrationsFileSchema } from '@deepnote/database-integrations'
import { z } from 'zod'

async function run() {
  const jsonSchema = z.toJSONSchema(integrationsFileSchema, {
    target: 'draft-07',
    io: 'input',
    // io: 'input' leaves additionalProperties unset on strip objects; close them so YAML editors flag unknown keys.
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type === 'object' && jsonSchema.additionalProperties === undefined) {
        jsonSchema.additionalProperties = false
      }
    },
  })
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
