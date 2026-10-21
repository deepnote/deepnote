import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { shutdownRuntime, registerRuntimeShutdownHooks } = vi.hoisted(() => ({
  shutdownRuntime: vi.fn(),
  registerRuntimeShutdownHooks: vi.fn(),
}))

vi.mock('./runtime', () => ({ shutdownRuntime, registerRuntimeShutdownHooks }))

import { startServer } from './server'

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('stdio shutdown', () => {
  it.each(['end', 'close'] as const)('waits for runtime cleanup on stdin %s before exiting', async event => {
    const stdin = new PassThrough()
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    let finishShutdown!: () => void
    shutdownRuntime.mockReturnValue(
      new Promise<void>(resolve => {
        finishShutdown = resolve
      })
    )

    await startServer()
    expect(registerRuntimeShutdownHooks).toHaveBeenCalledOnce()
    stdin.emit(event)
    await Promise.resolve()
    expect(shutdownRuntime).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()

    // EOF is commonly followed by close; cleanup must run only once.
    stdin.emit('end')
    stdin.emit('close')
    expect(shutdownRuntime).toHaveBeenCalledOnce()
    finishShutdown()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0))
    stdin.destroy()
  })
})
