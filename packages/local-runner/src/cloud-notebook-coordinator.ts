export interface CloudNotebookResolution {
  notebookId: string
  projectId?: string
  created: boolean
  /** Source block id to cloud block id, available when this operation created the notebook. */
  blockIds?: ReadonlyMap<string, string>
}

export interface CloudNotebookCoordinationOptions {
  baseUrl: string
  token: string
  projectName: string
  /** Stable local identity; keeps same-named notebooks distinct. */
  notebookId: string
  notebookName?: string
  allowCreate: boolean
}

const inFlightNotebooks = new Map<string, Promise<CloudNotebookResolution>>()
const projectTails = new Map<string, Promise<void>>()

/**
 * Coordinate notebook lookup/creation across all cloud entry points in this process.
 *
 * Calls for the same notebook share one resolution, preserving the block-id mapping for a run that
 * joins a schedule-triggered create (and vice versa). Calls for different notebooks in the same
 * project are serialized so the second lookup sees the project created by the first instead of
 * racing it into a duplicate project.
 *
 * Sharing a resolution is only safe because what it creates is neutral — the file's own content,
 * with no caller's one-off state baked in (see `createFromFile`). A resolver that wrote the first
 * caller's input overrides would hand them to everyone who joined it, and a schedule that joined a
 * run would inherit that run's arguments as its recurring defaults.
 *
 * The token is part of the ephemeral key so two authenticated workspaces cannot share state. Keys
 * are removed as soon as their operation settles.
 */
export function coordinateCloudNotebook(
  options: CloudNotebookCoordinationOptions,
  resolve: () => Promise<CloudNotebookResolution>
): Promise<CloudNotebookResolution> {
  const projectKey = JSON.stringify([options.baseUrl, options.token, options.projectName])
  const notebookKey = JSON.stringify([projectKey, options.notebookId, options.notebookName, options.allowCreate])
  const active = inFlightNotebooks.get(notebookKey)
  if (active) {
    return active
  }

  const coordinated = withProjectLock(projectKey, resolve)
  inFlightNotebooks.set(notebookKey, coordinated)
  void coordinated
    .finally(() => {
      if (inFlightNotebooks.get(notebookKey) === coordinated) {
        inFlightNotebooks.delete(notebookKey)
      }
    })
    .catch(() => undefined)
  return coordinated
}

/** Queue project mutations while allowing the action's result or failure to reach its own caller. */
async function withProjectLock<T>(projectKey: string, action: () => Promise<T>): Promise<T> {
  const previous = projectTails.get(projectKey) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const tail = previous.catch(() => undefined).then(() => gate)
  projectTails.set(projectKey, tail)

  await previous.catch(() => undefined)
  try {
    return await action()
  } finally {
    release()
    if (projectTails.get(projectKey) === tail) {
      projectTails.delete(projectKey)
    }
  }
}
