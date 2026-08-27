import type { RunBlockOutput } from './run-with-inputs'
import type { SnapshotView } from './snapshot-view'
import { parseSnapshot } from './snapshot-view'

/**
 * Read the per-block outputs out of a cloud snapshot's YAML, in document order.
 *
 * Split out of `cloud-common.ts` so it can bundle for the browser: everything else there resolves
 * tokens from `process.env`, which a page has no business carrying. Only `parseSnapshot` and the
 * block schemas are reachable from here.
 *
 * Any executable block type carries outputs — code, SQL, visualization, big-number — so read them
 * off whatever block has them rather than special-casing `code`.
 *
 * A snapshot that won't parse throws rather than returning nothing: the run succeeded, so "no
 * outputs" is a claim about the notebook, and it would be a false one. The caller still has the raw
 * YAML to inspect.
 */
export function extractOutputs(snapshotYaml: string): RunBlockOutput[] {
  let view: SnapshotView
  try {
    view = parseSnapshot(snapshotYaml)
  } catch (error) {
    throw new Error(
      `Deepnote returned a snapshot that could not be parsed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const outputs: RunBlockOutput[] = []
  for (const notebook of view.notebooks) {
    for (const block of notebook.blocks) {
      if (block.outputs.length > 0) {
        outputs.push({ blockId: block.id, outputs: block.outputs, executionCount: block.executionCount })
      }
    }
  }
  return outputs
}
