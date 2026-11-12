# @deepnote/federated-auth

Node.js client for Google OAuth in federated database integrations. It signs a user in to a BigQuery
integration through the Deepnote OAuth proxy and decides whether an access token can be minted for
that integration from a stored refresh token: PKCE and state generation, the loopback callback
server, the Google token endpoint client, the client fingerprint, and the Deepnote proxy URLs.

Used by `@deepnote/cli`.

This package is Node-only. Its entry point imports `node:http` and `node:crypto`, so do not import
it from browser bundles. `@deepnote/database-integrations` is the browser-safe package and must
never import it.

It ships ESM and CJS builds and runs on Node.js 20.18.0 or later.

## Installation

```bash
npm install @deepnote/federated-auth
```

## Usage

Sign in to the integration `integrationId`. `openInBrowser` and `saveCredential` stand for the host
application's own browser launcher and credential store; this package does not store anything. Keep
the refresh token in the operating system's secret store or a file only its owner can read, and keep
it and the start URL out of logs. `onListening` returns the launcher's promise, so a failed launch
fails the flow.

```ts
import {
  buildBigQueryOAuthStartUrl,
  computeClientFingerprint,
  generatePkcePair,
  generateStateNonce,
  getBigQueryOAuthRedirectUri,
  resolveDeepnoteProxyOrigin,
  runOAuthFlow,
} from "@deepnote/federated-auth";

const client = { clientId, clientSecret, project };
const proxyOrigin = resolveDeepnoteProxyOrigin("deepnote.com");
const { verifier, challenge } = generatePkcePair();
const state = generateStateNonce();
const controller = new AbortController(); // abort it to cancel the sign-in

const { refreshToken } = await runOAuthFlow({
  clientId: client.clientId,
  clientSecret: client.clientSecret,
  codeVerifier: verifier,
  state,
  redirectUri: getBigQueryOAuthRedirectUri(proxyOrigin),
  signal: controller.signal,
  onListening: (callbackUrl) =>
    openInBrowser(
      buildBigQueryOAuthStartUrl({
        proxyOrigin,
        clientId: client.clientId,
        state,
        codeChallenge: challenge,
        finalRedirect: callbackUrl,
      }),
    ),
});

await saveCredential(integrationId, {
  refreshToken,
  clientFingerprint: computeClientFingerprint(client),
});
```

Get an access token for a signed-in integration. `loadCredential` returns the
`StoredBigQueryCredential` saved above, or `undefined`. Handle every status, and persist
`rotatedRefreshToken` when Google issues a new refresh token.

```ts
import {
  type BigQueryOAuthClient,
  computeClientFingerprint,
  resolveBigQueryAccessToken,
} from "@deepnote/federated-auth";

async function getAccessToken(
  integrationId: string,
  client: BigQueryOAuthClient,
  refresh: boolean,
): Promise<string | undefined> {
  const result = await resolveBigQueryAccessToken({
    client,
    loadStoredCredential: () => loadCredential(integrationId),
    refresh,
  });

  switch (result.status) {
    case "ready":
      if (result.rotatedRefreshToken !== undefined) {
        await saveCredential(integrationId, {
          refreshToken: result.rotatedRefreshToken,
          clientFingerprint: computeClientFingerprint(client),
        });
      }
      return result.accessToken;
    case "verified":
      return undefined;
    case "missing-project":
      throw new Error("The integration has no project configured.");
    case "not-authenticated":
    case "grant-rejected":
      throw new Error("Sign in again.");
    case "client-mismatch":
      throw new Error(
        "The stored sign-in was issued against a different OAuth client.",
      );
    case "client-rejected":
      throw new Error("Google rejected the OAuth client credentials.");
  }
}
```

## API reference

| Export                                                                                       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generatePkcePair()`                                                                         | Returns `{ verifier, challenge }`: a random PKCE verifier and its S256 challenge. Pass `verifier` to `runOAuthFlow` as `codeVerifier` and `challenge` to `buildBigQueryOAuthStartUrl` as `codeChallenge`.                                                                                                                                                                                                                                                                                     |
| `generateStateNonce()`                                                                       | Returns a random URL-safe string for the OAuth `state` parameter. Pass the same value to `runOAuthFlow` and `buildBigQueryOAuthStartUrl`.                                                                                                                                                                                                                                                                                                                                                     |
| `resolveDeepnoteProxyOrigin(domain)`                                                         | Takes a hostname with an optional port and returns the proxy's normalized `https` origin: `'Deepnote.COM:443'` gives `'https://deepnote.com'`. Throws `InvalidDeepnoteDomainError` for a scheme, embedded credentials (`user:pw@`), path, query or fragment. It accepts any hostname, so allowlist a domain that comes from untrusted input.                                                                                                                                                  |
| `InvalidDeepnoteDomainError`                                                                 | Thrown by `resolveDeepnoteProxyOrigin`. `name` is `'InvalidDeepnoteDomainError'` and `domain` holds the rejected input. The message is `Invalid Deepnote domain "<domain>": expected a hostname such as "deepnote.com".` and names no CLI flag.                                                                                                                                                                                                                                               |
| `getBigQueryOAuthRedirectUri(proxyOrigin)`                                                   | Returns `<proxyOrigin>/auth/bigquery/google-oauth-callback`, the `redirect_uri` the proxy sends Google. Pass it to `runOAuthFlow` as `redirectUri` unchanged: the code exchange must repeat it byte for byte.                                                                                                                                                                                                                                                                                 |
| `buildBigQueryOAuthStartUrl({ proxyOrigin, clientId, state, codeChallenge, finalRedirect })` | Returns the URL to open in the browser: `<proxyOrigin>/auth/bigquery/extension/start` with the query parameters `client_id`, `state`, `code_challenge` and `final_redirect`. The proxy accepts only `http://127.0.0.1` or `http://localhost` as `finalRedirect`; pass the `callbackUrl` that `runOAuthFlow` hands to `onListening`. `proxyOrigin` must be the value `resolveDeepnoteProxyOrigin` returned: it is not validated here, and a value that does not form a URL throws `TypeError`. |
| `computeClientFingerprint(client)`                                                           | Takes a `BigQueryOAuthClient` and returns the SHA-256 hex digest of its `clientId`, `clientSecret` and `project`. Store it next to the refresh token; `resolveBigQueryAccessToken` compares it to detect that the client changed.                                                                                                                                                                                                                                                             |
| `runOAuthFlow(params)`                                                                       | Runs one loopback sign-in and resolves `{ refreshToken }`. See [`runOAuthFlow`](#runoauthflow).                                                                                                                                                                                                                                                                                                                                                                                               |
| `resolveBigQueryAccessToken(params)`                                                         | Decides whether an access token can be produced for one integration, and mints it. See [`resolveBigQueryAccessToken`](#resolvebigqueryaccesstoken).                                                                                                                                                                                                                                                                                                                                           |
| `BigQueryOAuthClient`                                                                        | Type: `{ clientId: string; clientSecret: string; project: string }`.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `StoredBigQueryCredential`                                                                   | Type: `{ refreshToken: string; clientFingerprint: string }`, a refresh token as the host stored it with the fingerprint of the client it was issued against.                                                                                                                                                                                                                                                                                                                                  |
| `BigQueryAccessTokenResult`                                                                  | Type: the result of `resolveBigQueryAccessToken`, a union discriminated by `status`.                                                                                                                                                                                                                                                                                                                                                                                                          |

### `runOAuthFlow`

Binds an ephemeral `127.0.0.1` port, waits for the single `/callback` redirect that the Deepnote
proxy sends after Google consent, exchanges the authorization code with Google, and closes the
server. A callback that arrives after the first valid one gets HTTP 409. The package installs no
`SIGINT` listener: cancel by aborting `signal`.

| Parameter      | Description                                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientId`     | The Google OAuth client ID.                                                                                                                                                                                                                                            |
| `clientSecret` | The Google OAuth client secret.                                                                                                                                                                                                                                        |
| `codeVerifier` | The `verifier` from `generatePkcePair`.                                                                                                                                                                                                                                |
| `state`        | The value from `generateStateNonce`. A callback whose `state` is missing or different ends the flow.                                                                                                                                                                   |
| `redirectUri`  | The value from `getBigQueryOAuthRedirectUri`.                                                                                                                                                                                                                          |
| `onListening`  | `(callbackUrl: string) => unknown`. Called with `http://127.0.0.1:<port>/callback` once the server accepts connections; use it to open the start URL. The flow does not wait for a returned promise, but a throw or a rejected promise fails the flow with that error. |
| `signal`       | Optional `AbortSignal`. An already-aborted signal rejects before a port is bound. A later abort cancels an in-flight code exchange and closes the port. Either way the flow rejects with the signal's reason.                                                          |
| `timeoutMs`    | Optional deadline for the whole flow. Defaults to 5 minutes.                                                                                                                                                                                                           |
| `tokenUrl`     | Optional token endpoint for the code exchange, meant for tests: the exchange sends it the client secret, so never derive it from untrusted input. Defaults to `https://oauth2.googleapis.com/token`.                                                                   |

Resolves with `{ refreshToken }`. Rejects with an `Error` for:

- a `state` mismatch: `The OAuth callback state did not match the expected value. Start the sign-in again.`;
- an error reported by the provider: `Google authorization failed: <error>`, with `(<error_description>)` appended when present;
- a callback with neither a code nor an error;
- a failed code exchange: Google rejecting the request or the client credentials, no refresh token in the response, or a network failure or timeout (the exchange is attempted once);
- the `timeoutMs` deadline: `Timed out waiting for Google authorization to complete.`;
- a failure to start the local server: `Failed to start the local OAuth callback server: <reason>`;
- `onListening` throwing or returning a rejected promise: the flow rejects with that error;
- `signal` aborting: the flow rejects with `signal.reason`, wrapped in an `Error` if it is not one.

### `resolveBigQueryAccessToken`

Takes `{ client, loadStoredCredential, refresh }`:

- `client`: a `BigQueryOAuthClient`, the integration's `clientId`, `clientSecret` and `project`.
- `loadStoredCredential`: `() => Promise<StoredBigQueryCredential | undefined>`, called at most once.
- `refresh`: with `false` the decision stops at `verified` and makes no network call.

It checks in this order and returns at the first match:

| `status`            | Meaning                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing-project`   | `client.project` is blank. `loadStoredCredential` is not called.                                                                                                                                      |
| `not-authenticated` | `loadStoredCredential` returned `undefined`.                                                                                                                                                          |
| `client-mismatch`   | The stored `clientFingerprint` differs from `computeClientFingerprint(client)`: the client or project changed since sign-in.                                                                          |
| `verified`          | `refresh` is `false`, and the stored credential matches `client`.                                                                                                                                     |
| `grant-rejected`    | Google rejected the refresh token (`invalid_grant`). Signing in again fixes it.                                                                                                                       |
| `client-rejected`   | Google rejected the OAuth client credentials (`invalid_client` or `unauthorized_client`). Signing in again does not fix it; correct `clientId` and `clientSecret`.                                    |
| `ready`             | `accessToken` was minted. `rotatedRefreshToken` is set only when Google returned a non-empty refresh token that differs from the stored one; the caller must persist it. Otherwise it is `undefined`. |

Any other error from `loadStoredCredential` or from the refresh rejects unchanged: a network error,
a timeout, HTTP 429 or 5xx after the retries, or a malformed response.

The function never writes or deletes stored credentials. The caller persists `rotatedRefreshToken`
and decides what to do with a `grant-rejected` entry.
