import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import express from 'express'
import open from 'open'
import passport from 'passport'
import { Strategy as OAuth2Strategy, type StrategyOptions } from 'passport-oauth2'
import { log } from '../output'
import { saveTokenForIntegration } from './federated-auth-tokens'
import type { FederatedAuthTokenEntry } from './federated-auth-tokens-schema'

const OAUTH_PORT = 21337

/**
 * In-memory state store for OAuth 2.0 CSRF protection.
 * Required because passport-oauth2's default store uses sessions, but we run
 * without sessions (session: false). Okta and other providers require the
 * state parameter to be sent and validated.
 */
function createMemoryStateStore(): StrategyOptions['store'] {
  let storedState: string | null = null
  return {
    store(_req, cb: (err: Error | null, state?: string) => void) {
      storedState = crypto.randomBytes(24).toString('base64url')
      cb(null, storedState)
    },
    verify(_req, providedState: string, cb: (err: Error | null, ok: boolean, info?: { message: string }) => void) {
      if (!storedState || storedState !== providedState) {
        return cb(null, false, { message: 'Invalid authorization request state.' })
      }
      storedState = null
      cb(null, true)
    },
  } as StrategyOptions['store']
}
const CALLBACK_PATH = '/auth/callback'
const START_PATH = '/auth/start'

export interface RunOAuthFlowParams {
  integrationId: string
  authUrl: string
  tokenUrl: string
  clientId: string
  clientSecret: string
}

export async function runOAuthFlow(params: RunOAuthFlowParams): Promise<FederatedAuthTokenEntry> {
  const { integrationId, authUrl, tokenUrl, clientId, clientSecret } = params

  const callbackURL = `http://localhost:${OAUTH_PORT}${CALLBACK_PATH}`
  const startURL = `http://localhost:${OAUTH_PORT}${START_PATH}`

  return new Promise((resolve, reject) => {
    let resolveOnce!: (entry: FederatedAuthTokenEntry) => void
    let rejectOnce!: (err: Error) => void
    const completion = new Promise<FederatedAuthTokenEntry>((res, rej) => {
      resolveOnce = res
      rejectOnce = rej
    })

    const strategyOptions: StrategyOptions = {
      clientID: clientId,
      clientSecret,
      authorizationURL: authUrl,
      tokenURL: tokenUrl,
      scope: ['openid', 'email', 'profile', 'offline_access'],
      callbackURL,
      customHeaders: { 'User-Agent': 'Deepnote' },
      store: createMemoryStateStore(),
    }

    const verifyCallback = async (
      accessToken: string,
      refreshToken: string,
      _profile: unknown,
      done: (err: Error | null, user?: { id: string }) => void
    ) => {
      if (!refreshToken || refreshToken.length === 0) {
        return done(
          new Error(
            'Refresh token was not present in the response from your OAuth provider. ' +
              'Please make sure that your OAuth provider is configured to issue refresh tokens.'
          )
        )
      }

      try {
        const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString()
        const entry: FederatedAuthTokenEntry = {
          integrationId,
          accessToken,
          refreshToken,
          expiresAt,
        }
        await saveTokenForIntegration(entry)
        done(null, { id: integrationId })
        resolveOnce(entry)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        done(error)
        rejectOnce(error)
      }
    }

    const strategy = new OAuth2Strategy(strategyOptions, verifyCallback)
    passport.use('trino-oauth', strategy)

    const app = express()

    app.get(START_PATH, passport.authenticate('trino-oauth', { session: false }))

    app.get(CALLBACK_PATH, (req: Request, res: Response) => {
      passport.authenticate('trino-oauth', { session: false }, (err: Error | null, _user: unknown) => {
        if (err) {
          const html = `<!DOCTYPE html><html><body><h2>${err.name}</h2><p>${err.message}</p></body></html>`
          res.status(400).send(html)
          rejectOnce(err)
          return
        }
        const successHtml =
          '<!DOCTYPE html><html><head><title>Success</title></head><body><p>The authentication was successful! You can close this window and continue in the terminal.</p></body></html>'
        res.send(successHtml)
      })(req, res)
    })

    const server = app.listen(OAUTH_PORT, () => {
      log('Opening browser to authenticate...')
      log('If the browser does not open automatically, visit:')
      log(startURL)
      try {
        open(startURL).catch(() => {})
      } catch {
        // ignore
      }
    })

    completion
      .then(entry => {
        server.close()
        resolve(entry)
      })
      .catch(err => {
        server.close()
        reject(err)
      })
  })
}
