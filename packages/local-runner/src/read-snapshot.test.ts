import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { readSnapshot } from './read-snapshot'

const FIXTURES = path.join(__dirname, '../../../test-fixtures')
const SNAPSHOT = readFileSync(path.join(FIXTURES, 'snapshot-view.snapshot.deepnote'), 'utf8')

/**
 * The parsing itself is tested in `@deepnote/pipelines`, which owns it. What is left here is the
 * part that needs Node: deciding whether a string is a path or the snapshot itself.
 */
describe('readSnapshot', () => {
  it('reads from a path, raw YAML, or a parsed object', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'snap-'))
    const snapshotPath = path.join(dir, 'run.snapshot.deepnote')
    writeFileSync(snapshotPath, SNAPSHOT)

    expect(readSnapshot(snapshotPath).projectName).toBe('Sales')
    expect(readSnapshot(SNAPSHOT).projectName).toBe('Sales')

    const file = deserializeDeepnoteFile(SNAPSHOT)
    expect(readSnapshot(file).notebooks[0].blocks.map(b => b.id)).toEqual(['b-input', 'b-md', 'b-code', 'b-sql'])
  })
})
