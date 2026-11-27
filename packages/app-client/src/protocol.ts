// A static app page asks the shell for a short-lived public API bearer token so
// in-page JavaScript can run the project's notebooks.
export const STATIC_FILES_API_TOKEN_REQUEST_MESSAGE = 'deepnote-static-files-api-token-request'
export const STATIC_FILES_API_TOKEN_RESPONSE_MESSAGE = 'deepnote-static-files-api-token-response'

// A public data app page mints its public API bearer token from its own origin
// instead, since an embedding site is not the shell and cannot answer.
export const STATIC_FILES_API_TOKEN_PATH = '/__deepnote/api-token'
// Set to `1` by an embedded app, whose shell does not answer, so the origin treats every viewer as a visitor.
export const STATIC_FILES_API_TOKEN_EMBEDDED_HEADER = 'x-deepnote-embedded'

// A static app page that loads the app client reports its runtime errors to the
// shell this way, so the app builder can offer to fix them.
export const STATIC_FILES_APP_ERROR_MESSAGE = 'deepnote-static-files-app-error'
export const STATIC_FILES_APP_READY_MESSAGE = 'deepnote-static-files-app-ready'
export const STATIC_FILES_APP_MAX_ERRORS = 10
export const STATIC_FILES_APP_MAX_ERROR_LENGTH = 500

// The app builder asks a static app page for a screenshot of itself, used as the app's preview.
export const STATIC_FILES_APP_PREVIEW_REQUEST_MESSAGE = 'deepnote-static-files-app-preview-request'
export const STATIC_FILES_APP_PREVIEW_WIDTH = 640
// The app builder asks a static app page that loads the app client to let the
// user pick an element, and the page reports the picked element's HTML back.
export const STATIC_FILES_APP_PICK_START_MESSAGE = 'deepnote-static-files-app-pick-start'
export const STATIC_FILES_APP_PICK_STOP_MESSAGE = 'deepnote-static-files-app-pick-stop'
export const STATIC_FILES_APP_PICK_MESSAGE = 'deepnote-static-files-app-pick'
