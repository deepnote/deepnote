import { ApiError } from '@deepnote/database-integrations'
import { z } from 'zod'

const notebookSchema = z
  .object({ id: z.string(), name: z.string().optional(), createdAt: z.string().optional() })
  .passthrough()
const projectSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    createdAt: z.string().optional(),
    notebooks: z.array(notebookSchema).optional(),
  })
  .passthrough()
const projectsSchema = z.object({ projects: z.array(projectSchema) }).passthrough()

export interface FindNotebookQuery {
  /** The project (workspace) name to match, e.g. from `file.project.name`. */
  projectName: string
  /** The notebook name to match within the project; falls back to the first notebook. */
  notebookName?: string
}

export interface FindNotebookOptions {
  requestTimeoutMs?: number
}

/**
 * Look up a notebook's id in the workspace by project + notebook name via `GET {baseUrl}/v2/projects`.
 *
 * Useful after an import ("Open in Deepnote"), where Deepnote assigns new ids that don't match the
 * local file. Prefers the most recently created matching project. Returns `undefined` if none match.
 */
export async function findNotebookId(
  baseUrl: string,
  token: string,
  query: FindNotebookQuery,
  options: FindNotebookOptions = {}
): Promise<string | undefined> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v2/projects`
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(options.requestTimeoutMs ?? 30_000),
  })
  if (!response.ok) {
    throw new ApiError(response.status, `Failed to list Deepnote projects: HTTP ${response.status}`)
  }
  const parsed = projectsSchema.safeParse(await response.json())
  if (!parsed.success) {
    return undefined
  }

  const projects = parsed.data.projects
    .filter(project => project.name === query.projectName)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  for (const project of projects) {
    const notebooks = project.notebooks ?? []
    const match = query.notebookName ? notebooks.find(notebook => notebook.name === query.notebookName) : undefined
    const notebook = match ?? notebooks[0]
    if (notebook) {
      return notebook.id
    }
  }
  return undefined
}
