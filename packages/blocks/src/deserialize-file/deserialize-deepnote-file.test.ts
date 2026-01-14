import { describe, expect, it, vi } from 'vitest'
import { deepnoteBlockSchema, deepnoteFileSchema, deepnoteSnapshotSchema } from './deepnote-file-schema'
import { deserializeDeepnoteFile } from './deserialize-deepnote-file'
import * as parseYamlModule from './parse-yaml'

vi.mock('./parse-yaml', async () => {
  const actual = await vi.importActual<typeof import('./parse-yaml')>('./parse-yaml')
  return {
    ...actual,
    parseYaml: vi.fn(),
  }
})

describe('deserializeDeepnoteFile', () => {
  const parseYaml = vi.mocked(parseYamlModule.parseYaml)

  it('successfully deserializes a valid Deepnote YAML file', () => {
    const yaml = `
      metadata:
        createdAt: '2025-01-01T00:00:00Z'
      version: '1'
      project:
        id: 'project-123'
        name: 'Test Project'
        notebooks: []
    `

    const validObject = {
      metadata: {
        createdAt: '2025-01-01T00:00:00Z',
      },
      version: '1',
      project: {
        id: 'project-123',
        name: 'Test Project',
        notebooks: [],
      },
    }

    parseYaml.mockReturnValue(validObject)

    const result = deserializeDeepnoteFile(yaml)
    expect(result).toEqual(validObject)
  })

  it('successfully deserializes a file with environment section', () => {
    const validObject = {
      metadata: {
        createdAt: '2025-01-01T00:00:00Z',
      },
      version: '1',
      environment: {
        hash: 'sha256:abc123',
        python: {
          version: '3.12.0',
          environment: 'uv',
        },
        platform: 'linux-x86_64',
        packages: {
          pandas: '2.1.0',
          numpy: '1.26.0',
        },
      },
      project: {
        id: 'project-123',
        name: 'Test Project',
        notebooks: [],
      },
    }

    parseYaml.mockReturnValue(validObject)

    const result = deserializeDeepnoteFile('yaml-content')
    expect(result.environment).toEqual(validObject.environment)
  })

  it('successfully deserializes a file with execution section', () => {
    const validObject = {
      metadata: {
        createdAt: '2025-01-01T00:00:00Z',
      },
      version: '1',
      execution: {
        startedAt: '2025-12-11T10:31:48.441Z',
        finishedAt: '2025-12-11T10:32:15.123Z',
        triggeredBy: 'user',
        inputs: {
          store: 'NYC-001',
        },
        summary: {
          blocksExecuted: 5,
          blocksSucceeded: 4,
          blocksFailed: 1,
          totalDurationMs: 27000,
        },
      },
      project: {
        id: 'project-123',
        name: 'Test Project',
        notebooks: [],
      },
    }

    parseYaml.mockReturnValue(validObject)

    const result = deserializeDeepnoteFile('yaml-content')
    expect(result.execution).toEqual(validObject.execution)
  })

  it('successfully deserializes a file with execution error', () => {
    const validObject = {
      metadata: {
        createdAt: '2025-01-01T00:00:00Z',
      },
      version: '1',
      execution: {
        startedAt: '2025-12-11T10:31:48.441Z',
        finishedAt: '2025-12-11T10:32:15.123Z',
        triggeredBy: 'schedule',
        error: {
          name: 'KernelCrash',
          message: 'Kernel died unexpectedly',
          traceback: ['line 1', 'line 2'],
        },
      },
      project: {
        id: 'project-123',
        name: 'Test Project',
        notebooks: [],
      },
    }

    parseYaml.mockReturnValue(validObject)

    const result = deserializeDeepnoteFile('yaml-content')
    expect(result.execution?.error).toEqual(validObject.execution.error)
  })

  it('successfully deserializes blocks with snapshot fields', () => {
    const validObject = {
      metadata: {
        createdAt: '2025-01-01T00:00:00Z',
      },
      version: '1',
      project: {
        id: 'project-123',
        name: 'Test Project',
        notebooks: [
          {
            id: 'notebook-1',
            name: 'Test Notebook',
            blocks: [
              {
                id: 'block-1',
                blockGroup: 'group-1',
                type: 'code',
                sortingKey: '0',
                content: 'x = 10',
                contentHash: 'md5:d3b07384d113edec49eaa6238ad5ff00',
                executionStartedAt: '2025-12-11T10:31:45.123Z',
                executionFinishedAt: '2025-12-11T10:31:45.138Z',
              },
            ],
          },
        ],
      },
    }

    parseYaml.mockReturnValue(validObject)

    const result = deserializeDeepnoteFile('yaml-content')
    const block = result.project.notebooks[0].blocks[0]
    expect(block.contentHash).toBe('md5:d3b07384d113edec49eaa6238ad5ff00')
    if (block.type === 'code') {
      expect(block.executionStartedAt).toBe('2025-12-11T10:31:45.123Z')
      expect(block.executionFinishedAt).toBe('2025-12-11T10:31:45.138Z')
    }
  })

  it('backward compatibility: files without new fields still parse', () => {
    const validObject = {
      metadata: {
        createdAt: '2025-01-01T00:00:00Z',
      },
      version: '1',
      project: {
        id: 'project-123',
        name: 'Test Project',
        notebooks: [
          {
            id: 'notebook-1',
            name: 'Test Notebook',
            blocks: [
              {
                id: 'block-1',
                blockGroup: 'group-1',
                type: 'code',
                sortingKey: '0',
                content: 'x = 10',
              },
            ],
          },
        ],
      },
    }

    parseYaml.mockReturnValue(validObject)

    const result = deserializeDeepnoteFile('yaml-content')
    expect(result.environment).toBeUndefined()
    expect(result.execution).toBeUndefined()
    expect(result.project.notebooks[0].blocks[0].contentHash).toBeUndefined()
  })

  it('throws error if YAML parsing fails', () => {
    parseYaml.mockImplementation(() => {
      throw new Error('Failed to parse Deepnote file: invalid syntax')
    })

    expect(() => deserializeDeepnoteFile('bad: yaml')).toThrow(Error)
    expect(() => deserializeDeepnoteFile('bad: yaml')).toThrow(/Failed to parse Deepnote file/)
  })

  it('throws error if schema validation fails with field message', () => {
    parseYaml.mockReturnValue({
      version: 1,
      blocks: [{}],
    })

    expect(() => deserializeDeepnoteFile('invalid schema')).toThrow(Error)
    expect(() => deserializeDeepnoteFile('invalid schema')).toThrow(/Failed to parse the Deepnote file:/)
  })

  it('throws generic error if schema validation issues array is empty', () => {
    const safeParseSpy = vi.spyOn(deepnoteFileSchema, 'safeParse').mockReturnValueOnce({
      success: false,
      error: { issues: [] },
    } as unknown as ReturnType<typeof deepnoteFileSchema.safeParse>)

    parseYaml.mockReturnValue({})

    expect(() => deserializeDeepnoteFile('invalid')).toThrow('Invalid Deepnote file.')

    safeParseSpy.mockRestore()
  })

  it('formats schema validation message with path prefix if available', () => {
    const safeParseSpy = vi.spyOn(deepnoteFileSchema, 'safeParse').mockReturnValueOnce({
      success: false,
      error: {
        issues: [
          {
            path: ['blocks', 0, 'type'],
            message: 'Required',
          },
        ],
      },
    } as unknown as ReturnType<typeof deepnoteFileSchema.safeParse>)

    parseYaml.mockReturnValue({})

    expect(() => deserializeDeepnoteFile('bad')).toThrow('Failed to parse the Deepnote file: blocks.0.type: Required.')

    safeParseSpy.mockRestore()
  })
})

describe('contentHash schema validation', () => {
  const createBlock = (contentHash: string | undefined) => ({
    id: 'block-1',
    blockGroup: 'group-1',
    type: 'code' as const,
    sortingKey: '0',
    content: 'x = 10',
    contentHash,
    metadata: {},
  })

  it('accepts contentHash with md5 prefix', () => {
    const block = createBlock('md5:d3b07384d113edec49eaa6238ad5ff00')
    const result = deepnoteBlockSchema.safeParse(block)
    expect(result.success).toBe(true)
  })

  it('accepts contentHash with sha256 prefix', () => {
    const block = createBlock('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    const result = deepnoteBlockSchema.safeParse(block)
    expect(result.success).toBe(true)
  })

  it('accepts contentHash with other prefixes', () => {
    const block = createBlock('blake2:abc123def456')
    const result = deepnoteBlockSchema.safeParse(block)
    expect(result.success).toBe(true)
  })

  it('accepts contentHash without prefix (plain hex)', () => {
    const block = createBlock('d3b07384d113edec49eaa6238ad5ff00')
    const result = deepnoteBlockSchema.safeParse(block)
    expect(result.success).toBe(true)
  })

  it('accepts undefined contentHash', () => {
    const block = createBlock(undefined)
    const result = deepnoteBlockSchema.safeParse(block)
    expect(result.success).toBe(true)
  })

  it('rejects contentHash with invalid hex characters', () => {
    const block = createBlock('md5:xyz123')
    const result = deepnoteBlockSchema.safeParse(block)
    expect(result.success).toBe(false)
  })

  it('rejects contentHash with empty string', () => {
    const block = createBlock('')
    const result = deepnoteBlockSchema.safeParse(block)
    expect(result.success).toBe(false)
  })

  it('rejects contentHash with only prefix and no hash', () => {
    const block = createBlock('md5:')
    const result = deepnoteBlockSchema.safeParse(block)
    expect(result.success).toBe(false)
  })
})

describe('deepnoteSnapshotSchema', () => {
  const baseFile = {
    metadata: {
      createdAt: '2025-01-01T00:00:00Z',
    },
    version: '1',
    project: {
      id: 'project-123',
      name: 'Test Project',
      notebooks: [],
    },
  }

  const validEnvironment = {
    hash: 'sha256:abc123',
    python: {
      version: '3.12.0',
      environment: 'uv' as const,
    },
    platform: 'linux-x86_64',
    packages: {
      pandas: '2.1.0',
    },
  }

  const validExecution = {
    startedAt: '2025-12-11T10:31:48.441Z',
    finishedAt: '2025-12-11T10:32:15.123Z',
    triggeredBy: 'user' as const,
    summary: {
      blocksExecuted: 5,
      blocksSucceeded: 5,
      blocksFailed: 0,
      totalDurationMs: 27000,
    },
  }

  it('accepts valid snapshot with environment and execution', () => {
    const snapshot = {
      ...baseFile,
      environment: validEnvironment,
      execution: validExecution,
    }

    const result = deepnoteSnapshotSchema.safeParse(snapshot)
    expect(result.success).toBe(true)
  })

  it('rejects snapshot without environment', () => {
    const snapshot = {
      ...baseFile,
      execution: validExecution,
    }

    const result = deepnoteSnapshotSchema.safeParse(snapshot)
    expect(result.success).toBe(false)
  })

  it('rejects snapshot without execution', () => {
    const snapshot = {
      ...baseFile,
      environment: validEnvironment,
    }

    const result = deepnoteSnapshotSchema.safeParse(snapshot)
    expect(result.success).toBe(false)
  })

  it('rejects snapshot without both environment and execution', () => {
    const result = deepnoteSnapshotSchema.safeParse(baseFile)
    expect(result.success).toBe(false)
  })

  it('still validates as deepnoteFileSchema when both fields present', () => {
    const snapshot = {
      ...baseFile,
      environment: validEnvironment,
      execution: validExecution,
    }

    const fileResult = deepnoteFileSchema.safeParse(snapshot)
    const snapshotResult = deepnoteSnapshotSchema.safeParse(snapshot)

    expect(fileResult.success).toBe(true)
    expect(snapshotResult.success).toBe(true)
  })
})
