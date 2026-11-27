import { postToParent, shellOrigin } from './error-reporting'
import {
  STATIC_FILES_API_TOKEN_EMBEDDED_HEADER,
  STATIC_FILES_API_TOKEN_PATH,
  STATIC_FILES_API_TOKEN_REQUEST_MESSAGE,
  STATIC_FILES_API_TOKEN_RESPONSE_MESSAGE,
} from './protocol'
import type { DeepnoteAuth, DeepnoteConnectOptions } from './types'

const HANDSHAKE_TIMEOUT_MS = 8_000
const TOKEN_RENEWAL_MARGIN_MS = 60_000

export interface TokenProvider {
  ensureAuth: () => Promise<DeepnoteAuth>
  invalidateAuth: () => void
}

function parseTokenReply(data: unknown): DeepnoteAuth | null {
  const reply = data as {
    type?: unknown
    token?: unknown
    apiOrigin?: unknown
    expiresAtSeconds?: unknown
    projectId?: unknown
    notebookId?: unknown
  } | null
  if (
    !reply ||
    reply.type !== STATIC_FILES_API_TOKEN_RESPONSE_MESSAGE ||
    typeof reply.token !== 'string' ||
    typeof reply.apiOrigin !== 'string' ||
    typeof reply.expiresAtSeconds !== 'number' ||
    !Number.isFinite(reply.expiresAtSeconds)
  ) {
    return null
  }
  try {
    const url = new URL(reply.apiOrigin)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null
    }

    return {
      token: reply.token,
      apiOrigin: url.origin,
      expiresAtMs: reply.expiresAtSeconds * 1000,
      projectId: typeof reply.projectId === 'string' ? reply.projectId : null,
      notebookId: typeof reply.notebookId === 'string' ? reply.notebookId : null,
    }
  } catch {
    return null
  }
}

export function createTokenProvider(options: Partial<DeepnoteConnectOptions>): TokenProvider {
  let auth: DeepnoteAuth | null = null
  // A failed handshake is kept, so later calls reject immediately. A page reload starts over.
  let handshake: Promise<DeepnoteAuth> | null = null

  // A public app mints its token on its own origin, so it also works embedded in another site, where
  // no shell answers. Sending the current token keeps the viewer's identity where cookies are blocked.
  async function requestOriginToken(originOptions: Partial<{ isEmbedded: boolean }>): Promise<DeepnoteAuth | null> {
    try {
      const response = await fetch(STATIC_FILES_API_TOKEN_PATH, {
        method: 'POST',
        headers: {
          ...(auth ? { authorization: `Bearer ${auth.token}` } : {}),
          ...(originOptions.isEmbedded ? { [STATIC_FILES_API_TOKEN_EMBEDDED_HEADER]: '1' } : {}),
        },
      })
      return response.status === 200
        ? parseTokenReply({ ...(await response.json()), type: STATIC_FILES_API_TOKEN_RESPONSE_MESSAGE })
        : null
    } catch {
      return null
    }
  }

  async function requestShellToken(): Promise<DeepnoteAuth> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage)
        reject(
          new Error(
            'Could not reach Deepnote. Open the app from its Deepnote link and make sure API access is allowed for this app.'
          )
        )
        if (options.onAuthExpired) {
          options.onAuthExpired()
        }
      }, HANDSHAKE_TIMEOUT_MS)
      function onMessage(event: MessageEvent) {
        if (event.source !== window.parent || event.origin !== shellOrigin) {
          return
        }
        const reply = parseTokenReply(event.data)
        if (!reply) {
          return
        }
        clearTimeout(timer)
        window.removeEventListener('message', onMessage)
        handshake = null
        auth = reply
        resolve(reply)
      }
      window.addEventListener('message', onMessage)
      postToParent({ type: STATIC_FILES_API_TOKEN_REQUEST_MESSAGE })
    })
  }

  async function requestToken(): Promise<DeepnoteAuth> {
    handshake ??= (async () => {
      // A top-level Deepnote shell knows the viewer even when the app cookie is blocked.
      // A framed shell has no session and never answers, so the origin must mint a visitor token.
      // oxlint-disable-next-line compat/compat -- Firefox lacks it and asks the origin first, where it keeps its cookie
      const isInTopLevelShell = window.parent === window.top && window.location.ancestorOrigins?.[0] === shellOrigin
      const isEmbedded = window.parent !== window.top
      const originAuth = isInTopLevelShell ? null : await requestOriginToken({ isEmbedded })
      if (!originAuth) {
        return requestShellToken()
      }
      handshake = null
      auth = originAuth
      return originAuth
    })()
    return handshake
  }

  async function ensureAuth(): Promise<DeepnoteAuth> {
    return auth && Date.now() < auth.expiresAtMs - TOKEN_RENEWAL_MARGIN_MS ? auth : requestToken()
  }

  return {
    ensureAuth,
    invalidateAuth: () => {
      auth = null
    },
  }
}
