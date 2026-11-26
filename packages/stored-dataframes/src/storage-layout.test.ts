import { describe, expect, it } from 'vitest'
import { dataframeDirectory } from './storage-layout'

const NOTEBOOK_ID = 'a8a7a6a5-1111-4222-8333-444455556666'
const BLOCK_ID = 'b1b2b3b4-5555-4666-8777-888899990000'

describe('dataframeDirectory', () => {
  describe('frame names', () => {
    it.each(['..', 'a/b', 'a\\b', '%2e%2e', 'a\0b', '', 'a b', 'revenue\n', 'a'.repeat(129)])(
      'refuses the name %j',
      name => {
        expect(dataframeDirectory({ type: 'named', name })).toBeNull()
      }
    )

    it.each([
      ['a single character', 'x', 'deepnote_dataframes/x'],
      ['letters of both cases, a digit, an underscore and a hyphen', 'Ab_9-z', 'deepnote_dataframes/Ab_9-z'],
      [
        '128 characters, the longest name the toolkit stores a frame under',
        'a'.repeat(128),
        `deepnote_dataframes/${'a'.repeat(128)}`,
      ],
    ])('places a name of %s under deepnote_dataframes', (_description, name, directory) => {
      expect(dataframeDirectory({ type: 'named', name })).toBe(directory)
    })
  })

  describe('block and notebook ids', () => {
    const unsafeIds = ['..', 'a/b', 'a\\b', '%2e%2e', 'a\0b', '', 'a b', `${BLOCK_ID}\n`]

    it.each(unsafeIds)('refuses the block id %j', blockId => {
      expect(dataframeDirectory({ type: 'block', notebookId: NOTEBOOK_ID, blockId })).toBeNull()
    })

    it.each(unsafeIds)('refuses the notebook id %j', notebookId => {
      expect(dataframeDirectory({ type: 'block', notebookId, blockId: BLOCK_ID })).toBeNull()
    })

    it('places a block under its notebook id, then its block id', () => {
      expect(dataframeDirectory({ type: 'block', notebookId: NOTEBOOK_ID, blockId: BLOCK_ID })).toBe(
        '.deepnote/dataframes/a8a7a6a5-1111-4222-8333-444455556666/b1b2b3b4-5555-4666-8777-888899990000'
      )
    })

    it.each([
      ['letters of both cases, a digit, an underscore and a hyphen', 'Ab_9-z', '.deepnote/dataframes/Ab_9-z/Ab_9-z'],
      [
        '255 characters, the longest name a file system takes',
        'a'.repeat(255),
        `.deepnote/dataframes/${'a'.repeat(255)}/${'a'.repeat(255)}`,
      ],
    ])('places a block whose notebook id and block id are both %s', (_description, id, directory) => {
      expect(dataframeDirectory({ type: 'block', notebookId: id, blockId: id })).toBe(directory)
    })
  })
})
