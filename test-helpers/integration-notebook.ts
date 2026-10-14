import type { DeepnoteFile } from '@deepnote/blocks'

/** A single-notebook project whose blocks are the given Python snippets, in order. */
export function codeNotebook(...codeBlocks: string[]): DeepnoteFile {
  return {
    version: '1.0.0',
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    project: {
      id: 'integration-project',
      name: 'Integration',
      notebooks: [
        {
          id: 'integration-notebook',
          name: 'Main',
          blocks: codeBlocks.map((content, index) => ({
            id: `block-${index + 1}`,
            blockGroup: `group-${index + 1}`,
            sortingKey: `a${index}`,
            type: 'code' as const,
            content,
            metadata: {},
            executionCount: null,
            outputs: [],
          })),
        },
      ],
    },
  }
}
