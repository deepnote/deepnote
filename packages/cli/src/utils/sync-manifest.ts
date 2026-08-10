import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { isErrnoENOENT } from './file-resolver'
import { isSafeRelativeFilePath } from './sync-paths'

/**
 * The sync manifest: `deepnote sync`'s local state file, written to the root of the synced
 * directory.
 *
 * It exists because names cannot carry identity — neither project nor folder names are unique in
 * Deepnote — so the manifest maps project ids to local directories, plus the fingerprints sync
 * decides with:
 *
 * - `dir`: the project's local directory (root-relative). A project is a directory of `.deepnote`
 *   files, one per notebook, because the export is a ZIP of one document per notebook.
 * - `notebooks`: the notebook filenames last synced into `dir`, so a notebook deleted in the cloud
 *   has its stale local file removed on the next pull.
 * - `modifiedAt`: the export's `metadata.modifiedAt` at last sync — sent back as `baseModifiedAt`
 *   on push so the server can detect a concurrent cloud edit (lost-update protection).
 * - `contentHash`: a canonical hash over the last-synced `.deepnote` documents (not the ZIP
 *   container — only the documents are deterministic). Comparing hashes of the local files and a
 *   fresh export against it separates "local edit", "cloud edit", and "both" without any clocks.
 * - `files`: per-path `size`/`updatedAt` from the last `--all-files` sync, for incremental
 *   downloads.
 *
 * The file is plain JSON with sorted keys, so it diffs cleanly if the user commits it to git.
 */

export const SYNC_MANIFEST_FILENAME = '.deepnote-sync.json'

const manifestFileRecordSchema = z.object({
  size: z.number(),
  updatedAt: z.string().optional(),
  /** SHA-256 of the file's bytes at the last sync. Lets push detect a local edit that preserves the
   * size, which `size` alone would miss. Absent for files synced before this was tracked. */
  hash: z.string().optional(),
})

const manifestProjectRecordSchema = z.object({
  dir: z.string().refine(isSafeRelativeFilePath, 'must be a safe root-relative path'),
  notebooks: z.array(z.string()),
  modifiedAt: z.string().optional(),
  contentHash: z.string(),
  files: z.record(z.string(), manifestFileRecordSchema).optional(),
})

const syncManifestSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), manifestProjectRecordSchema),
})

export type ManifestFileRecord = z.infer<typeof manifestFileRecordSchema>
export type ManifestProjectRecord = z.infer<typeof manifestProjectRecordSchema>
export type SyncManifest = z.infer<typeof syncManifestSchema>

export function emptySyncManifest(): SyncManifest {
  return { version: 1, projects: {} }
}

/**
 * Load the manifest from `rootDir`, or an empty one when none exists (a first sync).
 *
 * A manifest that exists but cannot be parsed is an error, not an empty manifest: treating it as
 * empty would make every local edit look like an untracked file and every project look new, which
 * is exactly the confusion the manifest exists to prevent.
 */
export async function loadSyncManifest(rootDir: string): Promise<SyncManifest> {
  const manifestPath = path.join(rootDir, SYNC_MANIFEST_FILENAME)
  let content: string
  try {
    content = await fs.readFile(manifestPath, 'utf-8')
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return emptySyncManifest()
    }
    throw error
  }

  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    throw new Error(
      `The sync manifest at ${manifestPath} is not valid JSON. ` +
        'Fix or delete it (deleting re-syncs everything from scratch).'
    )
  }
  const parsed = syncManifestSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `The sync manifest at ${manifestPath} has an unexpected shape: ` +
        `${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')}. ` +
        'Fix or delete it (deleting re-syncs everything from scratch).'
    )
  }

  // A lexically safe path can still escape through a symlink below the sync root.
  for (const record of Object.values(parsed.data.projects)) {
    let currentPath = rootDir
    for (const segment of record.dir.split('/')) {
      currentPath = path.join(currentPath, segment)
      try {
        if ((await fs.lstat(currentPath)).isSymbolicLink()) {
          throw new Error(
            `The sync manifest at ${manifestPath} contains a project directory with a symbolic-link ancestor: ${record.dir}. ` +
              'Fix or delete it (deleting re-syncs everything from scratch).'
          )
        }
      } catch (error) {
        if (isErrnoENOENT(error)) {
          break
        }
        throw error
      }
    }
  }
  return parsed.data
}

/** Write the manifest with sorted project ids and file paths, so repeated syncs produce stable,
 * git-diffable output. */
export async function saveSyncManifest(rootDir: string, manifest: SyncManifest): Promise<void> {
  const sortedProjects = Object.fromEntries(
    Object.entries(manifest.projects)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, record]) => [
        id,
        {
          ...record,
          notebooks: [...record.notebooks].sort((a, b) => a.localeCompare(b)),
          ...(record.files
            ? { files: Object.fromEntries(Object.entries(record.files).sort(([a], [b]) => a.localeCompare(b))) }
            : {}),
        },
      ])
  )
  const content = `${JSON.stringify({ version: manifest.version, projects: sortedProjects }, null, 2)}\n`
  await fs.writeFile(path.join(rootDir, SYNC_MANIFEST_FILENAME), content, 'utf-8')
}
