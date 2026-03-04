import crypto from 'node:crypto'
import type { Server } from 'node:http'
import type { Request, Response } from 'express'
import express from 'express'
import open from 'open'
import passport from 'passport'
import { Strategy as OAuth2Strategy, type StrategyOptions, type VerifyFunction } from 'passport-oauth2'
import { z } from 'zod'
import { error, log } from '../output'
import type { FederatedAuthTokenEntry } from './federated-auth-tokens-schema'

const oauthResultsSchema = z.object({
  expires_in: z.number().optional(),
})

export const DEFAULT_OAUTH_PORT = 21337

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
  port: number
}

export function runOAuthFlow(params: RunOAuthFlowParams): Promise<FederatedAuthTokenEntry> {
  const { integrationId, authUrl, tokenUrl, clientId, clientSecret, port } = params

  const callbackURL = `http://localhost:${port}${CALLBACK_PATH}`
  const startURL = `http://localhost:${port}${START_PATH}`

  return new Promise<FederatedAuthTokenEntry>((pResolve, pReject) => {
    let server: Server | null = null

    const closeServer = () => {
      if (server != null) {
        server.closeAllConnections()
        server.close()
        server = null
      }
    }

    const resolve = (entry: FederatedAuthTokenEntry) => {
      closeServer()
      pResolve(entry)
    }

    const reject = (err: Error) => {
      closeServer()
      pReject(err)
    }

    const flowTimeoutMs = 5 * 60 * 1000
    const flowTimeout = setTimeout(() => {
      reject(new Error('OAuth flow timed out. Please try again.'))
    }, flowTimeoutMs)

    const strategyOptions: StrategyOptions = {
      clientID: clientId,
      clientSecret,
      authorizationURL: authUrl,
      tokenURL: tokenUrl,
      scope: ['openid', 'email', 'profile', 'offline_access'],
      callbackURL,
      customHeaders: { 'User-Agent': 'Deepnote CLI' },
      store: createMemoryStateStore(),
    }

    const verifyCallback: VerifyFunction = (
      accessToken: string,
      refreshToken: string,
      results: unknown,
      _profile: unknown,
      done: (err: Error | null) => void
    ) => {
      clearTimeout(flowTimeout)

      if (!refreshToken || refreshToken.length === 0) {
        done(
          new Error(
            'Refresh token was not present in the response from your OAuth provider. ' +
              'Please make sure that your OAuth provider is configured to issue refresh tokens.'
          )
        )
        return
      }

      try {
        const parsed = oauthResultsSchema.safeParse(results)
        const expiresIn = parsed.success ? parsed.data.expires_in : undefined
        const expiresAt = expiresIn != null ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined
        const entry: FederatedAuthTokenEntry = {
          integrationId,
          accessToken,
          refreshToken,
          expiresAt,
        }
        done(null)
        resolve(entry)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        done(error)
      }
    }

    const strategy = new OAuth2Strategy(strategyOptions, verifyCallback)
    passport.use('trino-oauth', strategy)

    const app = express()

    app.use(passport.initialize())

    app.get(START_PATH, passport.authenticate('trino-oauth', { session: false }))

    app.get(CALLBACK_PATH, (req: Request, res: Response) => {
      passport.authenticate('trino-oauth', { session: false }, (err: Error | null, _user: unknown) => {
        if (err) {
          const errorHtml =
            '<!DOCTYPE html><html><head><title>Error</title></head><body><p>The authentication failed. Please try again. Check logs for more details.</p></body></html>'
          res.status(400).send(errorHtml)
          error(err.message)
          if (err.stack != null) {
            error(err.stack)
          }
          reject(err)
          return
        }

        const successHtml =
          '<!DOCTYPE html><html><head><title>Success</title></head><body><p>The authentication was successful! You can close this window and continue in the terminal.</p></body></html>'
        res.send(successHtml)
      })(req, res)
    })

    server = app.listen(port, () => {
      log('Opening browser to authenticate...')
      log('If the browser does not open automatically, visit:')
      log(startURL)
      open(startURL).catch(err => {
        log('Error opening browser:')
        log(err instanceof err ? err.message : String(err))
      })
    })
  })
}
