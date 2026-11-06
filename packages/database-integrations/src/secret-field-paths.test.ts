import { describe, expect, it } from 'vitest'
import type { DatabaseIntegrationType } from './database-integration-types'
import { isFederatedAuthSecretField } from './secret-field-paths'

describe('isFederatedAuthSecretField', () => {
  it.each<[DatabaseIntegrationType, { authMethod?: string }, string, boolean]>([
    ['big-query', { authMethod: 'google-oauth' }, 'clientSecret', true],
    ['snowflake', { authMethod: 'key-pair' }, 'dbtServiceToken', true],
    ['big-query', { authMethod: 'google-oauth' }, 'clientId', false],
    ['snowflake', { authMethod: 'password' }, 'password', false],
    ['pgsql', {}, 'password', false],
  ])('%s with metadata %j and key %s → %s', (type, metadata, key, expected) => {
    expect(isFederatedAuthSecretField(type, metadata, key)).toBe(expected)
  })
})
