import { describe, expect, it } from 'vitest'
import { computeClientFingerprint } from './client-fingerprint'

describe('computeClientFingerprint', () => {
  const base = { clientId: 'client-1', clientSecret: 'secret-1', project: 'project-1' }

  it.each(['clientId', 'clientSecret', 'project'] as const)('changes when %s changes', field => {
    expect(computeClientFingerprint(base)).not.toBe(computeClientFingerprint({ ...base, [field]: 'changed' }))
  })

  it('keeps the sha256 of "clientId|clientSecret|project" that existing stored tokens were issued against', () => {
    expect(computeClientFingerprint(base)).toBe('b6bf237c3535cd1ee235bda1a4ca49cc9a55f1ba8a74016475f480d6e0b464dc')
  })
})
