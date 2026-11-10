import type { IncomingMessage, ServerResponse } from 'node:http'
import type { components } from './deepnote-cloud-api.generated'

export type Schemas = components['schemas']

export type ImportedNotebook = Schemas['ImportProjectResponse']['notebooks'][number]

export interface MockContext {
  rootDir: string
  url: string
  publishedDataApps: Set<string>
}

export interface RouteRequest extends MockContext {
  req: IncomingMessage
  res: ServerResponse
  requestUrl: URL
  pathProjectId: string | undefined
}

export interface NotebookFile {
  filename: string
  content: Uint8Array
}
