export const DATAFRAME_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
export const NAMED_DATAFRAMES_DIRECTORY = 'deepnote_dataframes'
export const BLOCK_DATAFRAMES_DIRECTORY = '.deepnote/dataframes'
export const MANIFEST_FILE_NAME = 'manifest.json'

/**
 * The largest `manifest.json` a reader needs to accept. Must be at least deepnote-toolkit's `MANIFEST_MAX_BYTES`, in
 * `deepnote_toolkit/artifacts/_dataframe_storage_manifest.py`. This package does not enforce it; each reader does.
 */
export const MANIFEST_MAX_BYTES = 64 * 1024

export const FRAME_EXTENSION = '.arrow'
export const STORE_DATAFRAME_METADATA_KEY = 'deepnote_store_dataframe'

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]+$/

export type DataframeSource = { type: 'named'; name: string } | { type: 'block'; notebookId: string; blockId: string }

/**
 * The directory that holds `source`'s manifest and frame, as a POSIX path relative to the storage root. Returns null
 * when the name fails `DATAFRAME_NAME_PATTERN`, or when an ID holds anything but letters, digits, `_` and `-`.
 */
export function dataframeDirectory(source: DataframeSource): string | null {
  if (source.type === 'named') {
    return DATAFRAME_NAME_PATTERN.test(source.name) ? `${NAMED_DATAFRAMES_DIRECTORY}/${source.name}` : null
  }
  return SAFE_PATH_SEGMENT.test(source.notebookId) && SAFE_PATH_SEGMENT.test(source.blockId)
    ? `${BLOCK_DATAFRAMES_DIRECTORY}/${source.notebookId}/${source.blockId}`
    : null
}
