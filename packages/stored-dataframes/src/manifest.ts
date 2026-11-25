import { z } from 'zod'
import { FRAME_EXTENSION } from './storage-layout'

/** Validates the JSON of a `manifest.json` and maps it to a `Manifest`, ignoring keys it does not read. */
export const manifestSchema = z
  .object({
    file: z.templateLiteral([z.uuid(), FRAME_EXTENSION]).refine(file => file === file.toLowerCase()),
    rows: z.int().nonnegative(),
    batch_rows: z.array(z.int().nonnegative()),
  })
  .refine(({ rows, batch_rows }) => batch_rows.reduce((sum, count) => sum + count, 0) === rows)
  .transform(({ file, rows, batch_rows }) => ({
    file,
    referenceId: file.slice(0, -FRAME_EXTENSION.length),
    rows,
    batchRows: batch_rows,
  }))

/**
 * `referenceId` is `file` without its extension. `batchRows` holds the row count of each record batch in file order,
 * and adds up to `rows`.
 */
export type Manifest = z.infer<typeof manifestSchema>

/**
 * The manifest `text` holds, or null when `text` is not JSON or not a valid manifest. Never throws. Bounding the size
 * of `text`, with `MANIFEST_MAX_BYTES`, is up to the caller.
 */
export function parseManifest(text: string): Manifest | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const result = manifestSchema.safeParse(json)

  return result.success ? result.data : null
}
