// Auto-generates TypeScript type definitions from Zod schemas in @deepnote/blocks.
// Output: skills/deepnote/references/schema.ts
// Usage: pnpm --filter @deepnote/cli generate:skill-schema

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  deepnoteBlockSchema,
  deepnoteFileSchema,
  environmentSchema,
  executionErrorSchema,
  executionSchema,
  executionSummarySchema,
} from '@deepnote/blocks'
import { compile } from 'json-schema-to-typescript'
import { z } from 'zod'

const HEADER = `// Auto-generated from Zod schemas in @deepnote/blocks
// Do not edit manually. Regenerate with: pnpm --filter @deepnote/cli generate:skill-schema
//
// DeepnoteFile and DeepnoteSnapshot are omitted — they wrap DeepnoteBlock
// inside project.notebooks[].blocks[]. See SKILL.md for the file structure.
`

// Only generate types that are compact and non-redundant.
// DeepnoteFile and DeepnoteSnapshot embed DeepnoteBlock inline, which triples the output.
interface SchemaEntry {
  name: string
  schema: z.ZodType
}

const schemas: SchemaEntry[] = [
  { name: 'DeepnoteBlock', schema: deepnoteBlockSchema },
  { name: 'DeepnoteFile', schema: deepnoteFileSchema },
  { name: 'Environment', schema: environmentSchema },
  { name: 'Execution', schema: executionSchema },
  { name: 'ExecutionSummary', schema: executionSummarySchema },
  { name: 'ExecutionError', schema: executionErrorSchema },
]

async function run() {
  const parts: string[] = [HEADER]

  for (const { name, schema } of schemas) {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-07', io: 'input' })

    if (name === 'DeepnoteFile') {
      // For DeepnoteFile, strip the massive notebooks.blocks array to keep it compact.
      // The block schema is already defined in DeepnoteBlock above.
      stripBlocksFromFile(jsonSchema)
    }

    // biome-ignore lint/suspicious/noExplicitAny: JSON schema types are incompatible between libraries
    const ts = await compile(jsonSchema as any, name, {
      bannerComment: '',
      additionalProperties: false,
      unknownAny: false,
      style: { singleQuote: true },
    })
    parts.push(ts.trim())
  }

  const output = `${parts.join('\n\n')}\n`
  const outPath = path.join('../../skills/deepnote/references/schema.ts')
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, output)
  console.log(`Wrote ${outPath}`)
}

// biome-ignore lint/suspicious/noExplicitAny: walking arbitrary JSON schema structure
function stripBlocksFromFile(schema: any) {
  try {
    const projectProps = schema.properties?.project?.properties
    if (!projectProps?.notebooks?.items?.properties?.blocks) {
      return
    }
    projectProps.notebooks.items.properties.blocks = {
      type: 'array',
      description: 'Array of DeepnoteBlock objects (see DeepnoteBlock type above)',
      tsType: 'DeepnoteBlock[]',
    }
  } catch {
    // If structure doesn't match, leave as-is
  }
}

run()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
