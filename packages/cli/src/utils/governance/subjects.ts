/**
 * Finding data subjects in a notebook, and fingerprinting them so the finding is not itself a
 * disclosure.
 *
 * The regulatory question — "where is this person's data?" — is only answerable if something
 * indexes people against locations. Building that index in the clear would create a new, more
 * convenient copy of exactly the personal data it exists to govern, so every identifier here is
 * reduced to an HMAC before it is written anywhere.
 *
 * HMAC, not a plain hash: the identifier space is enumerable. There are not many email addresses a
 * given company holds, and an attacker with an unsalted index can hash a mailing list and read the
 * answers straight off. The salt is what makes the index useless on its own, which is why building
 * a persistent index requires one to be supplied rather than generated.
 */

import crypto from 'node:crypto'

/** The kinds of identifier recognised. Email is the one a DSAR arrives as. */
export type SubjectKind = 'email'

export interface SubjectMatch {
  kind: SubjectKind
  /**
   * The identifier reduced to one form per person, used as the HMAC input. Transient: it is the
   * personal data, and nothing retains it past fingerprinting.
   */
  canonical: string
  /** Domain part. A company, not a person — kept in the clear so findings can be triaged. */
  domain: string
  /** One-based line within the scanned text. */
  line: number
}

/** Local parts that address a function rather than a person. */
const ROLE_ACCOUNTS = new Set([
  'admin',
  'billing',
  'contact',
  'devnull',
  'donotreply',
  'do-not-reply',
  'help',
  'hello',
  'hi',
  'info',
  'mail',
  'mailer-daemon',
  'marketing',
  'no-reply',
  'noreply',
  'postmaster',
  'root',
  'sales',
  'security',
  'support',
  'team',
  'webmaster',
  // Not an address at all: `git@github.com` in an SSH remote, `pip@…` in a package URL.
  'git',
  'pip',
  'npm',
])

/** Local parts that are placeholders in documentation and templates. */
const PLACEHOLDER_LOCAL_PARTS = new Set([
  'email',
  'example',
  'firstname',
  'first_name',
  'foo',
  'bar',
  'lastname',
  'last_name',
  'me',
  'name',
  'someone',
  'test',
  'user',
  'username',
  'you',
  'your',
  'your_email',
  'youremail',
])

/** Domains reserved for documentation (RFC 2606) and the obvious stand-ins. */
const PLACEHOLDER_DOMAIN_PATTERN =
  /^(?:example\.(?:com|org|net)|test|invalid|localhost|example|domain\.com|email\.com|company\.com|mycompany\.com|acme\.(?:com|org)|foo\.(?:com|bar)|yourdomain\.com)$/i

/**
 * Email addresses. Deliberately narrower than RFC 5322: the aim is to find the addresses people
 * actually paste into notebooks, not to validate every address a standard permits.
 */
const EMAIL_PATTERN =
  /(^|[^A-Za-z0-9._%+\-/@])([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)/g

/**
 * Reduce an address to one form per person.
 *
 * The local part is lower-cased and its `+tag` suffix dropped, so `Jane+invoices@acme.com` and
 * `jane@acme.com` are the same subject. A DSAR names a person, not a mailbox alias, and an index
 * that answers only for the exact spelling the request happened to use answers nothing.
 *
 * Returns `undefined` for anything that is not a person: role accounts and documentation
 * placeholders.
 */
export function canonicalizeEmail(address: string): { canonical: string; domain: string } | undefined {
  const at = address.lastIndexOf('@')
  if (at <= 0) {
    return undefined
  }

  const domain = address.slice(at + 1).toLowerCase()
  const localPart = address.slice(0, at).toLowerCase()
  const withoutTag = localPart.split('+')[0]

  if (withoutTag === '' || PLACEHOLDER_DOMAIN_PATTERN.test(domain) || !domain.includes('.')) {
    return undefined
  }
  if (ROLE_ACCOUNTS.has(withoutTag) || PLACEHOLDER_LOCAL_PARTS.has(withoutTag)) {
    return undefined
  }

  return { canonical: `${withoutTag}@${domain}`, domain }
}

function lineAt(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++
    }
  }
  return line
}

/**
 * Find every data subject identified in `text`.
 *
 * One match per (subject, line): a list of a hundred addresses is a hundred subjects, but the same
 * address twice on one line is one place to go and fix.
 */
export function findSubjectIdentifiers(text: string): SubjectMatch[] {
  const matches: SubjectMatch[] = []
  const seen = new Set<string>()

  EMAIL_PATTERN.lastIndex = 0
  let match = EMAIL_PATTERN.exec(text)
  while (match !== null) {
    const [, prefix, localPart, domain] = match
    const canonicalized = canonicalizeEmail(`${localPart}@${domain}`)
    const offset = match.index + prefix.length
    // Overlapping matches are possible once the leading boundary is consumed; step back so an
    // address immediately following another is still seen.
    EMAIL_PATTERN.lastIndex = Math.max(EMAIL_PATTERN.lastIndex - 1, offset + 1)
    match = EMAIL_PATTERN.exec(text)

    if (!canonicalized) {
      continue
    }
    const line = lineAt(text, offset)
    const key = `${canonicalized.canonical}:${line}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    matches.push({ kind: 'email', canonical: canonicalized.canonical, domain: canonicalized.domain, line })
  }

  return matches
}

/** What a redacted identifier is replaced with. Matches the credential redaction marker. */
export const SUBJECT_REDACTION_MARKER = '<redacted>'

/**
 * Mask every data subject in `text`.
 *
 * Findings carry context taken straight from the block — a label is the block's first line, and for
 * `owner = "jane@acme.io"` that line is the personal data the finding is about. Reporting "one
 * person appears in four notebooks" while printing their address beside it would be a disclosure
 * dressed as a privacy control.
 *
 * Role accounts and documentation placeholders are left alone: they are not people, and masking
 * them would only make the finding harder to read.
 */
export function redactSubjects(text: string): string {
  const matches: Array<{ start: number; end: number }> = []

  EMAIL_PATTERN.lastIndex = 0
  let match = EMAIL_PATTERN.exec(text)
  while (match !== null) {
    const [, prefix, localPart, domain] = match
    const start = match.index + prefix.length
    const end = start + localPart.length + 1 + domain.length
    if (canonicalizeEmail(`${localPart}@${domain}`)) {
      matches.push({ start, end })
    }
    EMAIL_PATTERN.lastIndex = Math.max(EMAIL_PATTERN.lastIndex - 1, start + 1)
    match = EMAIL_PATTERN.exec(text)
  }

  let redacted = text
  for (const { start, end } of matches.reverse()) {
    redacted = redacted.slice(0, start) + SUBJECT_REDACTION_MARKER + redacted.slice(end)
  }
  return redacted
}

/** Length of an emitted fingerprint, in hex characters. 128 bits: collisions are not a concern,
 *  and a DSAR answer that merged two people would be worse than no answer. */
const FINGERPRINT_LENGTH = 32

export interface SubjectFingerprinter {
  /** HMAC of a canonical identifier under the configured salt. */
  fingerprint(canonical: string): string
  /**
   * Fingerprint of the salt itself, so an index can record which salt built it and a lookup can
   * refuse to answer under a different one. Derived through HMAC so it does not shorten the work
   * of recovering the salt.
   */
  saltFingerprint: string
}

/** Minimum salt length. Short enough to be memorable is short enough to be guessed. */
export const MIN_SALT_LENGTH = 16

export class SubjectSaltError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubjectSaltError'
  }
}

export function createSubjectFingerprinter(salt: string): SubjectFingerprinter {
  if (salt.length < MIN_SALT_LENGTH) {
    throw new SubjectSaltError(
      `The subject salt must be at least ${MIN_SALT_LENGTH} characters. Email addresses are an enumerable space: a short salt can be brute-forced, and recovering it turns the index back into a list of people.`
    )
  }

  return {
    fingerprint: (canonical: string) =>
      crypto.createHmac('sha256', salt).update(canonical).digest('hex').slice(0, FINGERPRINT_LENGTH),
    saltFingerprint: crypto.createHmac('sha256', salt).update('deepnote-subject-salt').digest('hex').slice(0, 16),
  }
}
