import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./cli', () => ({
  run: vi.fn(),
}))

describe('bin', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls run() when imported', async () => {
    const { run } = await import('./cli')

    await import('./bin')

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith()
  })
})
