import { connect } from './connect'
import { listenForElementPicking } from './element-picking'
import { reportErrorsToParent } from './error-reporting'
import { answerPreviewRequests } from './preview-capture'
import type { DeepnoteClient, DeepnoteConnectOptions } from './types'

declare global {
  interface Window {
    Deepnote: { connect: (options?: Partial<DeepnoteConnectOptions>) => DeepnoteClient }
  }
}

window.Deepnote = { connect }
answerPreviewRequests()
reportErrorsToParent()
listenForElementPicking()
