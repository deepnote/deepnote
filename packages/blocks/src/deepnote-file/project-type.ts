import { type DeepnoteFile, PROJECT_TYPES, type ProjectType } from './deepnote-file-schema'

/**
 * Returns the Deepnote type of a `.deepnote` file's project.
 *
 * @returns `project.type` when it is one of {@link PROJECT_TYPES}, and `'standard'` when it is absent, empty or
 * a value this version does not know.
 */
export function getProjectType(project: Pick<DeepnoteFile['project'], 'type'>): ProjectType {
  return PROJECT_TYPES.find(type => type === project.type) ?? 'standard'
}

/**
 * Returns whether a project of `type` holds exactly one notebook.
 */
export function isSingleNotebookProjectType(type: ProjectType): boolean {
  return type !== 'standard'
}
