/**
 * The subject index: which people appear in which notebooks, stored as fingerprints.
 *
 * This is the surface that gives a governance tool regulatory teeth. A subject access request names
 * a person and asks where their data is; without an index the answer is a manual trawl through
 * every notebook in the workspace, which is why the honest answer is usually "we don't know".
 *
 * The index holds no addresses. Each person is an HMAC under a salt the operator supplies and keeps
 * somewhere the index is not, so the file on disk cannot be read back into a list of people. What it
 * does hold — domains, notebook paths, counts — is enough to act on and is not personal data on its
 * own.
 */

import type { DeepnoteBlock } from '@deepnote/blocks'
import { findSubjectIdentifiers, type SubjectFingerprinter, type SubjectKind } from './subjects'
import type { WorkspaceProject } from './workspace'

/** Where in a block an identifier was found. */
export type SubjectSource = 'content' | 'output'

export interface SubjectLocation {
  projectId: string
  projectName: string
  /** Notebook id. Names are not unique within a project, so this is what counting keys on. */
  notebookId: string
  notebookName: string
  blockId: string
  /** Workspace-root-relative path of the file. */
  path: string
  line: number
  source: SubjectSource
}

export interface SubjectEntry {
  /** HMAC of the canonical identifier. The identifier itself is never stored. */
  fingerprint: string
  kind: SubjectKind
  /** Domain part — a company rather than a person, kept in the clear so findings can be triaged. */
  domain: string
  /** The domain is one of the workspace's own. */
  internal: boolean
  locations: SubjectLocation[]
  projectCount: number
  notebookCount: number
}

export interface SubjectIndex {
  version: 1
  createdAt: string
  /** The workspace the index was built from. */
  root: string
  /** Identifies the salt without revealing it, so a lookup can refuse to answer under another. */
  saltFingerprint: string
  /** Domains treated as the workspace's own. Everyone else is an external subject. */
  internalDomains: string[]
  summary: {
    subjects: number
    externalSubjects: number
    locations: number
    projects: number
    notebooks: number
    /** Subjects appearing in more than one notebook. */
    scattered: number
  }
  subjects: SubjectEntry[]
}

/**
 * Whether a parsed JSON document is actually one of our indexes.
 *
 * Only the fields a lookup depends on are checked — version, the salt fingerprint it compares
 * against, and the array it searches. The point is not to validate every entry; it is to tell
 * "this is the wrong file" apart from "this index holds nothing about that person", which are the
 * same answer to a caller and opposite answers to a regulator.
 */
export function isSubjectIndex(value: unknown): value is SubjectIndex {
  const candidate = value as Partial<SubjectIndex> | null | undefined
  return candidate?.version === 1 && typeof candidate.saltFingerprint === 'string' && Array.isArray(candidate.subjects)
}

export interface BuildSubjectIndexOptions {
  fingerprinter: SubjectFingerprinter
  /** Domains belonging to the workspace's own organization. */
  internalDomains?: string[]
  root?: string
  /** Fixed timestamp, so tests and reproducible builds do not depend on the clock. */
  now?: Date
}

/** A subject in this many notebooks or more is scattered. Two is not a threshold to tune: data
 *  about one person in two places is already two places to honour an erasure request in. */
export const SCATTER_NOTEBOOK_THRESHOLD = 2

/** Block content, as a string. */
function contentOf(block: DeepnoteBlock): string {
  return typeof (block as { content?: unknown }).content === 'string' ? (block as { content: string }).content : ''
}

/**
 * Persisted outputs, as a string.
 *
 * Outputs matter more than content here: a block whose code says `SELECT email FROM users` holds no
 * personal data, while the table it printed and saved into the file holds all of it.
 */
function outputsOf(block: DeepnoteBlock): string {
  const outputs = (block as { outputs?: unknown }).outputs
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return ''
  }
  try {
    return JSON.stringify(outputs)
  } catch {
    // Circular or otherwise unserializable outputs are not worth failing an index over.
    return ''
  }
}

/** Build the index over `projects`. Pure: the same tree and salt always give the same index. */
export function buildSubjectIndex(projects: WorkspaceProject[], options: BuildSubjectIndexOptions): SubjectIndex {
  const internalDomains = (options.internalDomains ?? []).map(domain => domain.toLowerCase().replace(/^@/, ''))
  const entries = new Map<string, SubjectEntry>()
  let notebookCount = 0

  for (const project of projects) {
    for (const notebook of project.notebooks) {
      notebookCount++
      for (const block of notebook.blocks) {
        for (const [source, text] of [
          ['content', contentOf(block)],
          ['output', outputsOf(block)],
        ] as Array<[SubjectSource, string]>) {
          if (text === '') {
            continue
          }
          for (const match of findSubjectIdentifiers(text)) {
            const fingerprint = options.fingerprinter.fingerprint(match.canonical)
            const entry = entries.get(fingerprint) ?? {
              fingerprint,
              kind: match.kind,
              domain: match.domain,
              internal: internalDomains.includes(match.domain),
              locations: [],
              projectCount: 0,
              notebookCount: 0,
            }
            entry.locations.push({
              projectId: project.id,
              projectName: project.name,
              notebookId: notebook.id,
              notebookName: notebook.name,
              blockId: block.id,
              path: notebook.path,
              line: match.line,
              source,
            })
            entries.set(fingerprint, entry)
          }
        }
      }
    }
  }

  const subjects = [...entries.values()].map(entry => ({
    ...entry,
    projectCount: new Set(entry.locations.map(location => location.projectId)).size,
    // Keyed on notebook id, not name: two notebooks in one project may share a name, and counting
    // them as one understates how far a person's data is spread — which is the number an erasure
    // request is scoped by.
    notebookCount: new Set(entry.locations.map(location => `${location.projectId}:${location.notebookId}`)).size,
  }))

  // Most scattered first: the ranking is the work queue.
  subjects.sort(
    (a, b) =>
      b.notebookCount - a.notebookCount ||
      b.locations.length - a.locations.length ||
      a.fingerprint.localeCompare(b.fingerprint)
  )

  return {
    version: 1,
    createdAt: (options.now ?? new Date()).toISOString(),
    root: options.root ?? '',
    saltFingerprint: options.fingerprinter.saltFingerprint,
    internalDomains,
    summary: {
      subjects: subjects.length,
      externalSubjects: subjects.filter(subject => !subject.internal).length,
      locations: subjects.reduce((total, subject) => total + subject.locations.length, 0),
      projects: projects.length,
      notebooks: notebookCount,
      scattered: subjects.filter(subject => subject.notebookCount >= SCATTER_NOTEBOOK_THRESHOLD).length,
    },
    subjects,
  }
}

export interface SubjectLookup {
  /** The fingerprint the identifier resolved to under the supplied salt. */
  fingerprint: string
  /** False when the index was built under a different salt — every answer would be a false negative. */
  saltMatches: boolean
  /** The index entry, when the subject appears in the workspace. */
  entry?: SubjectEntry
}

/**
 * Look a subject up in a built index.
 *
 * A salt mismatch is reported rather than silently returning "not found": under the wrong salt every
 * lookup misses, and a confidently wrong "we hold no data about this person" is the one answer a
 * subject access request must never produce.
 */
export function lookupSubject(
  index: SubjectIndex,
  canonical: string,
  fingerprinter: SubjectFingerprinter
): SubjectLookup {
  const fingerprint = fingerprinter.fingerprint(canonical)
  const saltMatches = index.saltFingerprint === fingerprinter.saltFingerprint
  return {
    fingerprint,
    saltMatches,
    entry: saltMatches ? index.subjects.find(subject => subject.fingerprint === fingerprint) : undefined,
  }
}

/**
 * The most common domain across external subjects, with the share of subjects it covers.
 *
 * Offered so a first run can classify internal and external subjects without configuration — but it
 * is a guess, and the caller is expected to say so rather than present it as a fact.
 */
export function inferInternalDomain(
  subjects: Array<{ domain: string }>
): { domain: string; subjectCount: number; share: number } | undefined {
  if (subjects.length === 0) {
    return undefined
  }
  const counts = new Map<string, number>()
  for (const { domain } of subjects) {
    counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  const [domain, subjectCount] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return { domain, subjectCount, share: subjectCount / subjects.length }
}
