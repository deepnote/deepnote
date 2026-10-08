import { describe, expect, it } from 'vitest'
import {
  canonicalizeEmail,
  createSubjectFingerprinter,
  findSubjectIdentifiers,
  MIN_SALT_LENGTH,
  redactSubjects,
  SubjectSaltError,
} from './subjects'

const SALT = 'a-sufficiently-long-test-salt'

describe('canonicalizeEmail', () => {
  it('lower-cases and keeps the domain', () => {
    expect(canonicalizeEmail('Jane.Doe@Acme-Corp.io')).toEqual({
      canonical: 'jane.doe@acme-corp.io',
      domain: 'acme-corp.io',
    })
  })

  it('drops a plus tag so one person is one subject', () => {
    expect(canonicalizeEmail('jane+invoices@acme-corp.io')?.canonical).toBe('jane@acme-corp.io')
    expect(canonicalizeEmail('jane+invoices@acme-corp.io')?.canonical).toBe(
      canonicalizeEmail('jane@acme-corp.io')?.canonical
    )
  })

  it.each(['support@acme-corp.io', 'no-reply@acme-corp.io', 'git@github.com'])(
    'rejects the role account %s',
    address => {
      expect(canonicalizeEmail(address)).toBeUndefined()
    }
  )

  it.each(['you@example.com', 'user@acme-corp.io', 'jane@example.org', 'test@test', 'name@yourdomain.com'])(
    'rejects the placeholder %s',
    address => {
      expect(canonicalizeEmail(address)).toBeUndefined()
    }
  )

  it('rejects a malformed address', () => {
    expect(canonicalizeEmail('not-an-address')).toBeUndefined()
    expect(canonicalizeEmail('@acme-corp.io')).toBeUndefined()
    expect(canonicalizeEmail('jane@localhost')).toBeUndefined()
  })
})

describe('findSubjectIdentifiers', () => {
  it('finds an address in a SQL predicate', () => {
    const matches = findSubjectIdentifiers("SELECT * FROM users WHERE email = 'jane.doe@acme-corp.io'")

    expect(matches).toEqual([{ kind: 'email', canonical: 'jane.doe@acme-corp.io', domain: 'acme-corp.io', line: 1 }])
  })

  it('finds every address in a list', () => {
    const matches = findSubjectIdentifiers("emails = ['a@acme-corp.io', 'b@acme-corp.io', 'c@other-co.net']")

    expect(matches.map(m => m.canonical)).toEqual(['a@acme-corp.io', 'b@acme-corp.io', 'c@other-co.net'])
  })

  it('reports the line of each match', () => {
    const matches = findSubjectIdentifiers('x = 1\n\nowner = "jane@acme-corp.io"')

    expect(matches[0].line).toBe(3)
  })

  it('counts the same subject once per line', () => {
    const matches = findSubjectIdentifiers('jane@acme-corp.io jane+tag@acme-corp.io\njane@acme-corp.io')

    expect(matches.map(m => m.line)).toEqual([1, 2])
  })

  it('does not treat an SSH remote or a package URL as a subject', () => {
    expect(findSubjectIdentifiers('git+ssh://git@github.com/deepnote/deepnote.git')).toEqual([])
  })

  it('does not treat documentation placeholders as subjects', () => {
    expect(findSubjectIdentifiers('# Set OWNER to your@email.com or someone@example.com')).toEqual([])
  })

  it('returns nothing for text without addresses', () => {
    expect(findSubjectIdentifiers('SELECT count(*) FROM users')).toEqual([])
    expect(findSubjectIdentifiers('')).toEqual([])
  })
})

describe('redactSubjects', () => {
  it('masks an address a finding would otherwise echo', () => {
    expect(redactSubjects('owner = "jane@acme-corp.io"')).toBe('owner = "<redacted>"')
  })

  it('masks every address in a line', () => {
    expect(redactSubjects("IN ('a@acme-corp.io', 'b@acme-corp.io')")).toBe("IN ('<redacted>', '<redacted>')")
  })

  it('leaves role accounts and placeholders readable, since they are not people', () => {
    expect(redactSubjects('support@acme-corp.io')).toBe('support@acme-corp.io')
    expect(redactSubjects('git+ssh://git@github.com/org/repo.git')).toBe('git+ssh://git@github.com/org/repo.git')
    expect(redactSubjects('you@example.com')).toBe('you@example.com')
  })

  it('leaves text without addresses unchanged, and is idempotent', () => {
    expect(redactSubjects('SELECT count(*) FROM users')).toBe('SELECT count(*) FROM users')
    expect(redactSubjects(redactSubjects('a@acme-corp.io'))).toBe('<redacted>')
  })
})

describe('createSubjectFingerprinter', () => {
  it('is stable for the same salt and identifier', () => {
    expect(createSubjectFingerprinter(SALT).fingerprint('jane@acme-corp.io')).toBe(
      createSubjectFingerprinter(SALT).fingerprint('jane@acme-corp.io')
    )
  })

  it('differs across salts, so one index cannot be read with another', () => {
    const a = createSubjectFingerprinter(SALT)
    const b = createSubjectFingerprinter(`${SALT}-other`)

    expect(a.fingerprint('jane@acme-corp.io')).not.toBe(b.fingerprint('jane@acme-corp.io'))
    expect(a.saltFingerprint).not.toBe(b.saltFingerprint)
  })

  it('emits 128 bits, so two subjects never merge', () => {
    expect(createSubjectFingerprinter(SALT).fingerprint('jane@acme-corp.io')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('never reveals the salt through the salt fingerprint', () => {
    expect(createSubjectFingerprinter(SALT).saltFingerprint).not.toContain(SALT)
  })

  it('refuses a salt short enough to brute-force', () => {
    expect(() => createSubjectFingerprinter('short')).toThrow(SubjectSaltError)
    expect(() => createSubjectFingerprinter('x'.repeat(MIN_SALT_LENGTH))).not.toThrow()
  })
})

describe('redactSubjects — a version is not a domain', () => {
  it.each(['numpy@1.26.0', 'pandas@2.0.1', 'scikit-learn@1.4'])('leaves the pinned dependency %s alone', pinned => {
    // The version half matched the domain pattern, so a package inventory came out with its
    // versions masked and the generated SBOM named components nothing could resolve.
    expect(redactSubjects(pinned)).toBe(pinned)
  })

  it('leaves a bare IP-literal domain alone, which identifies a host rather than a person', () => {
    expect(redactSubjects('svc@192.168.1.1')).toBe('svc@192.168.1.1')
  })

  it.each([
    'jane.doe@acme-corp.io',
    'a@b.co',
    'bob.jones@partner.example',
    'z@sub.domain.co.uk',
    'x@xn--80ak6aa92e.com',
  ])('still masks %s', address => {
    expect(redactSubjects(address)).toBe('<redacted>')
  })
})
