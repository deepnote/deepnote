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
      version: 1
      blocks:
        - id: "123"
          type: "text-cell-p"
          content: "Hello"
    `

    const validObject = {
      version: 1,
      blocks: [
        {
          id: '123',
          type: 'text-cell-p',
          content: 'Hello',
        },
      ],
    }

    parseYaml.mockReturnValue(validObject)

    const result = deserializeDeepnoteFile(yaml)
    expect(result).toEqual(validObject)
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
