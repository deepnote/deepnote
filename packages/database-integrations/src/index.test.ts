import { describe, it } from 'vitest'

describe('index', () => {
  it('should be importable', async () => {
    await import('./index')
  })
})
