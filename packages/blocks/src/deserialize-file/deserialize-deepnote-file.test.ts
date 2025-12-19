import { describe, expect, it, vi } from 'vitest'
import { deepnoteFileSchema } from './deepnote-file-schema'
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
    expect(block.executionStartedAt).toBe('2025-12-11T10:31:45.123Z')
    expect(block.executionFinishedAt).toBe('2025-12-11T10:31:45.138Z')
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
