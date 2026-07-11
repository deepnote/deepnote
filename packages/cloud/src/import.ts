import { ApiError } from '@deepnote/database-integrations'

/** Default Deepnote domain (the API lives at `api.<domain>`). */
const DEFAULT_DOMAIN = 'deepnote.com'
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

interface InitImportResponse {
  importId: string
  uploadUrl: string
  expiresAt?: string
}

export interface UploadNotebookOptions {
  /** Deepnote domain. Defaults to `deepnote.com`. */
  domain?: string
  requestTimeoutMs?: number
}

export interface UploadedNotebook {
  importId: string
  /** Browser URL that imports the uploaded file into Deepnote (creating the notebook). */
  launchUrl: string
}

/**
 * Upload a `.deepnote` file to Deepnote via the import API — the headless half of "Open in Deepnote".
 *
 * Mirrors the CLI's import-client endpoints: `POST https://api.<domain>/v1/import/init` for a
 * presigned URL, then a `PUT` of the bytes to it. Returns a `launchUrl`; opening it in a browser
 * completes the import and creates the notebook (there is no headless "get the created id" step).
 */
export async function uploadNotebook(
  fileBytes: Uint8Array,
  fileName: string,
  options: UploadNotebookOptions = {}
): Promise<UploadedNotebook> {
  const domain = options.domain ?? DEFAULT_DOMAIN
  const timeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  const initResponse = await fetch(`https://api.${domain}/v1/import/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, fileSize: fileBytes.byteLength }),
    signal: AbortSignal.timeout(timeout),
  })
  if (!initResponse.ok) {
    throw new ApiError(initResponse.status, `Failed to initialize import: HTTP ${initResponse.status}`)
  }
  const init = (await initResponse.json()) as InitImportResponse

  const uploadResponse = await fetch(init.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: fileBytes,
    signal: AbortSignal.timeout(timeout),
  })
  if (!uploadResponse.ok) {
    throw new ApiError(uploadResponse.status, `Failed to upload notebook: HTTP ${uploadResponse.status}`)
  }

  const launchUrl = `https://${domain}/launch?${new URLSearchParams({ importId: init.importId }).toString()}`
  return { importId: init.importId, launchUrl }
}
