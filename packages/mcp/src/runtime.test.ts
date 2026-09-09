import { describe, expect, it } from 'vitest'
import { readServerIdleTimeoutMs, SERVER_IDLE_ENV_VAR } from './runtime'

describe('readServerIdleTimeoutMs', () => {
  it('defaults to five minutes', () => {
    expect(readServerIdleTimeoutMs({})).toBe(300_000)
    expect(readServerIdleTimeoutMs({ [SERVER_IDLE_ENV_VAR]: '  ' })).toBe(300_000)
  })

  it('reads whole and fractional seconds', () => {
    expect(readServerIdleTimeoutMs({ [SERVER_IDLE_ENV_VAR]: '30' })).toBe(30_000)
    expect(readServerIdleTimeoutMs({ [SERVER_IDLE_ENV_VAR]: '0.5' })).toBe(500)
  })

  it('treats zero as stop immediately', () => {
    expect(readServerIdleTimeoutMs({ [SERVER_IDLE_ENV_VAR]: '0' })).toBe(0)
  })

  it('falls back to the default for invalid values', () => {
    expect(readServerIdleTimeoutMs({ [SERVER_IDLE_ENV_VAR]: 'soon' })).toBe(300_000)
    expect(readServerIdleTimeoutMs({ [SERVER_IDLE_ENV_VAR]: '-5' })).toBe(300_000)
  })
})
