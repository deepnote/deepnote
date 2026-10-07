/**
 * Hardcoded credential detection.
 *
 * Two rules, kept apart because their precision is not comparable:
 *
 * 1. **Provider patterns** — a literal that is self-evidently a credential because its issuer gave
 *    it a recognizable shape (`AKIA…`, `ghp_…`, a PEM header). A match is a finding on its own.
 * 2. **Secret-named assignment** — a long string literal assigned to a name like `api_key`. This is
 *    a heuristic, so it is reported one severity lower and placeholders are filtered out hard.
 *
 * Nothing here records the matched value. Every finding carries a `fingerprint`: a truncated
 * SHA-256 of the secret, which is enough to tell "the same key appears in four notebooks" from
 * "four different keys" without the report becoming a second place the credential is written down.
 * A report you cannot safely paste into a ticket does not get acted on.
 */

import crypto from 'node:crypto'

export type SecretConfidence = 'pattern' | 'heuristic'

export interface SecretFinding {
  /** Human-readable kind, e.g. `AWS access key ID`. */
  kind: string
  /** How the match was made — `pattern` matches are self-evident, `heuristic` ones are not. */
  confidence: SecretConfidence
  /** Truncated SHA-256 of the matched secret. The secret itself is never retained. */
  fingerprint: string
  /** One-based line of the match within the scanned content. */
  line: number
  /** The variable the secret was assigned to, when the match came from an assignment. */
  variable?: string
}

interface ProviderPattern {
  kind: string
  pattern: RegExp
  /** Which capture group holds the secret; defaults to the whole match. */
  group?: number
}

/**
 * Credential shapes specific enough that a match needs no further context. Each is anchored on a
 * vendor-assigned prefix and a fixed or near-fixed length, which is what keeps them from firing on
 * ordinary identifiers.
 */
// The character classes below (`gh[pousr]_`, `xox[baprse]-`) are how each issuer spells its token
// prefixes; the spell checker reads the class contents as words, which they are not.
// cspell:ignore pousr baprse bxox
const PROVIDER_PATTERNS: ProviderPattern[] = [
  { kind: 'AWS access key ID', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { kind: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { kind: 'Slack token', pattern: /\bxox[baprse]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'Stripe key', pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'OpenAI or Anthropic key', pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{24,}\b/g },
  { kind: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'Private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { kind: 'JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // A connection URI carrying an inline password: `postgres://user:hunter2@host/db`. The password
  // group is what gets fingerprinted, so the same database reached from two notebooks matches.
  { kind: 'Connection string password', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:([^\s/@"']{3,})@/g, group: 1 },
]

/** Variable and key names that mean the value beside them is a credential. */
const SECRET_NAME_PATTERN =
  /\b(\w*(?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key|private[_-]?key|credential|auth[_-]?key)\w*)\b/i

/**
 * `name = 'value'` and `"name": "value"` in Python, JSON, and YAML — enough to cover what a
 * notebook actually contains without pulling in a parser per language.
 */
const ASSIGNMENT_PATTERN = /(['"]?)([A-Za-z_][\w.-]*)\1\s*[:=]\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g

/** Minimum literal length for the heuristic rule. Shorter values are too weak to be real secrets. */
const MIN_HEURISTIC_SECRET_LENGTH = 8

/**
 * Values that look like secrets positionally but carry no secret: environment lookups, template
 * holes, and the placeholder vocabulary people type when they mean "fill this in".
 */
const PLACEHOLDER_PATTERN =
  /^$|^\s+$|os\.environ|getenv|^\$|\$\{|\{\{|^<.*>$|^your[_-]|^my[_-]|^(?:x{3,}|\*{3,}|\.{3,})$|^(?:changeme|placeholder|redacted|example|dummy|fake|sample|todo|none|null|undefined|secret|password|insert[_-]?here)$/i

/** `API_KEY`, `DATABASE_URL` — an env var name being referenced, not a literal secret. */
const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/

/** Truncated SHA-256 of `value`. Stable across runs and machines, so findings can be deduplicated. */
export function fingerprintSecret(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** One-based line number of `offset` within `content`. */
function lineAt(content: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line++
    }
  }
  return line
}

/**
 * True when `value` is a placeholder rather than a credential. Applied only to the heuristic rule:
 * a literal matching a provider pattern is a real credential shape regardless of its name, and
 * vendors' own example keys are revoked but still worth reporting.
 */
function isPlaceholder(value: string): boolean {
  if (PLACEHOLDER_PATTERN.test(value.trim())) {
    return true
  }
  if (ENV_VAR_NAME_PATTERN.test(value.trim())) {
    return true
  }
  // A single repeated character (`--------`, `00000000`) is a filler, not a secret.
  return new Set(value.trim()).size <= 1
}

/**
 * Scan `content` for hardcoded credentials.
 *
 * @param options.includeHeuristic Run the secret-named-assignment rule as well as the provider
 * patterns. Off for prose blocks, where `password: "something"` is far more likely to be an
 * instruction than a credential.
 */
export function findSecrets(content: string, options: { includeHeuristic?: boolean } = {}): SecretFinding[] {
  const findings: SecretFinding[] = []
  const seen = new Set<string>()

  const record = (finding: SecretFinding): void => {
    // One finding per (fingerprint, line): a key assigned to a secret-named variable matches both
    // rules, and reporting it twice would overstate how many credentials are actually in the file.
    const key = `${finding.fingerprint}:${finding.line}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    findings.push(finding)
  }

  for (const { kind, pattern, group } of PROVIDER_PATTERNS) {
    // The patterns are module-level and `g`-flagged, so reset the shared cursor before each scan.
    pattern.lastIndex = 0
    let match = pattern.exec(content)
    while (match !== null) {
      const secret = group === undefined ? match[0] : match[group]
      if (secret) {
        record({
          kind,
          confidence: 'pattern',
          fingerprint: fingerprintSecret(secret),
          line: lineAt(content, match.index),
        })
      }
      match = pattern.exec(content)
    }
  }

  if (options.includeHeuristic !== false) {
    ASSIGNMENT_PATTERN.lastIndex = 0
    let match = ASSIGNMENT_PATTERN.exec(content)
    while (match !== null) {
      const [, , name, , rawValue] = match
      const value = rawValue.replace(/\\(.)/g, '$1')
      if (
        SECRET_NAME_PATTERN.test(name) &&
        value.length >= MIN_HEURISTIC_SECRET_LENGTH &&
        !isPlaceholder(value) &&
        !SECRET_NAME_PATTERN.test(value)
      ) {
        record({
          kind: 'Credential assigned to a secret-named variable',
          confidence: 'heuristic',
          fingerprint: fingerprintSecret(value),
          line: lineAt(content, match.index),
          variable: name,
        })
      }
      match = ASSIGNMENT_PATTERN.exec(content)
    }
  }

  return findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind))
}
