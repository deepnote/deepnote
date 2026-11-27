import {
  STATIC_FILES_APP_ERROR_MESSAGE,
  STATIC_FILES_APP_MAX_ERROR_LENGTH,
  STATIC_FILES_APP_MAX_ERRORS,
  STATIC_FILES_APP_READY_MESSAGE,
} from './protocol'

// The Deepnote app serves this script, so its URL names the shell's origin. Any site can embed a public
// app, and only the shell may hear from the page or drive its element picker.
const script = document.currentScript
export const shellOrigin = script instanceof HTMLScriptElement && script.src ? new URL(script.src).origin : null

export function postToParent(message: Record<string, unknown>) {
  if (shellOrigin) {
    window.parent.postMessage(message, shellOrigin)
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return '[Unserializable value]'
  }
}

export function reportErrorsToParent() {
  if (window.parent === window) {
    return
  }

  const reportedErrors = new Set<string>()
  function report(message: string, line: number | null, source: string | null) {
    const key = `${message}|${line}|${source}`
    if (reportedErrors.has(key) || reportedErrors.size >= STATIC_FILES_APP_MAX_ERRORS) {
      return
    }
    reportedErrors.add(key)

    postToParent({
      type: STATIC_FILES_APP_ERROR_MESSAGE,
      message: message.slice(0, STATIC_FILES_APP_MAX_ERROR_LENGTH),
      line,
      source,
    })
  }

  window.addEventListener(
    'error',
    (event: Event) => {
      if (event instanceof ErrorEvent) {
        report(
          event.error ? describe(event.error) : event.message,
          event.lineno || null,
          // The page URL carries an access token, so strip query parameters from reported sources.
          event.filename ? (event.filename.split(/[?#]/)[0] ?? null) : null
        )
        return
      }

      // Resource load failures only reach capturing listeners.
      const target = event.target
      if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
        const url = target instanceof HTMLScriptElement ? target.src : target.href
        report(`Failed to load ${url.split(/[?#]/)[0]}`, null, null)
      }
    },
    true
  )
  window.addEventListener('unhandledrejection', event => {
    report(`Unhandled promise rejection: ${describe(event.reason)}`, null, null)
  })

  // biome-ignore lint/suspicious/noConsole: reports the page's console errors to the shell
  const consoleError = console.error
  console.error = (...args: Array<unknown>) => {
    report(args.map(describe).join(' '), null, null)
    consoleError.apply(console, args)
  }

  const reportReady = (ready: boolean) => postToParent({ type: STATIC_FILES_APP_READY_MESSAGE, ready })
  reportReady(true)
  window.addEventListener('pagehide', () => reportReady(false))
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      reportReady(true)
    }
  })
}
