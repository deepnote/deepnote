import { describe, expect, it } from 'vitest'
import { STATIC_FILES_API_TOKEN_PATH } from './index'

describe('index', () => {
  it('loads in Node without a DOM', () => {
    expect(STATIC_FILES_API_TOKEN_PATH).toBe('/__deepnote/api-token')
  })
})
