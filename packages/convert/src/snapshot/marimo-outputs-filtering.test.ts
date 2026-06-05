import fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMarimoOutputsFromCache } from './marimo-outputs'

// Mock fs to test filtering logic without file system
vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn(),
  },
}))

describe('getMarimoOutputsFromCache - MIME value filtering', () => {
  const mockFs = fs as unknown as {
    access: ReturnType<typeof vi.fn>
    readFile: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.access.mockResolvedValue(undefined)
  })

  it('should keep outputs with non-empty string MIME values', async () => {
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({
        version: '1.0.0',
        metadata: { marimo_version: '0.1.0' },
        cells: [
          {
            id: 'cell-1',
            code_hash: 'hash1',
            outputs: [{ type: 'data', data: { 'text/plain': 'result' } }],
            console: [],
          },
        ],
      })
    )

    const result = await getMarimoOutputsFromCache('/test/file.py')
    expect(result?.get('hash1')).toHaveLength(1)
  })

  it('should filter out outputs with only empty string MIME values', async () => {
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({
        version: '1.0.0',
        metadata: { marimo_version: '0.1.0' },
        cells: [
          {
            id: 'cell-1',
            code_hash: 'hash1',
            outputs: [{ type: 'data', data: { 'text/plain': '' } }],
            console: [],
          },
        ],
      })
    )

    const result = await getMarimoOutputsFromCache('/test/file.py')
    expect(result?.has('hash1')).toBe(false)
  })

  it('should filter out outputs with only whitespace string MIME values', async () => {
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({
        version: '1.0.0',
        metadata: { marimo_version: '0.1.0' },
        cells: [
          {
            id: 'cell-1',
            code_hash: 'hash1',
            outputs: [{ type: 'data', data: { 'text/plain': '   \n\t  ' } }],
            console: [],
          },
        ],
      })
    )

    const result = await getMarimoOutputsFromCache('/test/file.py')
    expect(result?.has('hash1')).toBe(false)
  })

  // Issue 2: Tests for non-string MIME values (should pass after fix)
  it('should keep outputs with array MIME values (e.g., image data)', async () => {
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({
        version: '1.0.0',
        metadata: { marimo_version: '0.1.0' },
        cells: [
          {
            id: 'cell-1',
            code_hash: 'hash1',
            outputs: [
              {
                type: 'data',
                data: {
                  'text/plain': '',
                  'image/png': ['base64encodeddata'],
                },
              },
            ],
            console: [],
          },
        ],
      })
    )

    const result = await getMarimoOutputsFromCache('/test/file.py')
    expect(result?.get('hash1')).toHaveLength(1)
  })

  it('should keep outputs with object MIME values', async () => {
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({
        version: '1.0.0',
        metadata: { marimo_version: '0.1.0' },
        cells: [
          {
            id: 'cell-1',
            code_hash: 'hash1',
            outputs: [
              {
                type: 'data',
                data: {
                  'text/plain': '',
                  'application/json': { key: 'value' },
                },
              },
            ],
            console: [],
          },
        ],
      })
    )

    const result = await getMarimoOutputsFromCache('/test/file.py')
    expect(result?.get('hash1')).toHaveLength(1)
  })

  it('should keep outputs with numeric MIME values', async () => {
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({
        version: '1.0.0',
        metadata: { marimo_version: '0.1.0' },
        cells: [
          {
            id: 'cell-1',
            code_hash: 'hash1',
            outputs: [
              {
                type: 'data',
                data: { 'text/plain': '', 'application/x-number': 42 },
              },
            ],
            console: [],
          },
        ],
      })
    )

    const result = await getMarimoOutputsFromCache('/test/file.py')
    expect(result?.get('hash1')).toHaveLength(1)
  })

  it('should always keep stream outputs regardless of filtering', async () => {
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({
        version: '1.0.0',
        metadata: { marimo_version: '0.1.0' },
        cells: [
          {
            id: 'cell-1',
            code_hash: 'hash1',
            outputs: [],
            console: [{ channel: 'stdout', data: 'output' }],
          },
        ],
      })
    )

    const result = await getMarimoOutputsFromCache('/test/file.py')
    expect(result?.get('hash1')).toHaveLength(1)
    expect(result?.get('hash1')?.[0].output_type).toBe('stream')
  })
})
