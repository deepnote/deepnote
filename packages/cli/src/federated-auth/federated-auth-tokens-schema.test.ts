import { describe, expect, it } from 'vitest'
import {
  baseTokensFileSchema,
  type FederatedAuthTokenEntry,
  federatedAuthTokenEntrySchema,
} from './federated-auth-tokens-schema'

describe('federatedAuthTokenEntrySchema', () => {
  it('should accept valid token entry', () => {
    const valid: FederatedAuthTokenEntry = {
      integrationId: 'abc-123',
      accessToken: 'eyJhbG...',
      refreshToken: 'dGhpcyBpcyBhIHJl...',
      expiresAt: '2026-02-25T15:30:00.000Z',
    }
    expect(federatedAuthTokenEntrySchema.parse(valid)).toEqual(valid)
  })

  it('should accept entry without expiresAt', () => {
    const valid = {
      integrationId: 'abc-123',
      accessToken: 'token',
      refreshToken: 'refresh',
    }
    expect(federatedAuthTokenEntrySchema.parse(valid)).toEqual(valid)
  })

  it('should reject missing integrationId', () => {
    const invalid = {
      accessToken: 'token',
      refreshToken: 'refresh',
    }
    expect(() => federatedAuthTokenEntrySchema.parse(invalid)).toThrow()
  })

  it('should reject missing accessToken', () => {
    const invalid = {
      integrationId: 'abc',
      refreshToken: 'refresh',
    }
    expect(() => federatedAuthTokenEntrySchema.parse(invalid)).toThrow()
  })

  it('should reject missing refreshToken', () => {
    const invalid = {
      integrationId: 'abc',
      accessToken: 'token',
    }
    expect(() => federatedAuthTokenEntrySchema.parse(invalid)).toThrow()
  })
})

describe('baseTokensFileSchema', () => {
  it('should accept empty tokens array', () => {
    expect(baseTokensFileSchema.parse({ tokens: [] })).toEqual({ tokens: [] })
  })

  it('should accept missing tokens (defaults to [])', () => {
    expect(baseTokensFileSchema.parse({})).toEqual({ tokens: [] })
  })

  it('should accept array of records', () => {
    const parsed = baseTokensFileSchema.parse({
      tokens: [{ integrationId: 'x', accessToken: 'a', refreshToken: 'r' }],
    })
    expect(parsed.tokens).toHaveLength(1)
    expect(parsed.tokens[0]).toEqual({ integrationId: 'x', accessToken: 'a', refreshToken: 'r' })
  })
})
