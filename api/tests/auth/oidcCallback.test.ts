import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startApi, type TestApi } from '#tests/support/harness.js'

// Never resolved: every request to it is answered by the stub below, in this process, which is
// what lets a callback complete without an issuer to reach.
const ISSUER = 'https://sso.invalid/application/o/diele/'
const CLIENT_ID = 'diele-test'

let api: TestApi
let nonce = ''
const realFetch = globalThis.fetch

/**
 * Encodes one part of a compact JWT.
 * @param {object} part - Header or claims
 * @returns {string} - The part as base64url JSON
 */
function encode(part: object): string {
  return Buffer.from(JSON.stringify(part)).toString('base64url')
}

/**
 * Answers what openid-client asks the issuer for: discovery, then the code exchange. The id
 * token is not signed, because openid-client does not check the signature of one it received
 * over the token endpoint's own TLS connection unless non-repudiation is turned on.
 * @param {URL} url - Endpoint being asked
 * @returns {Response} - The issuer's answer
 */
function issuerAnswer(url: URL): Response {
  if (url.pathname.endsWith('/.well-known/openid-configuration')) {
    return Response.json({
      issuer: ISSUER,
      authorization_endpoint: new URL('authorize/', ISSUER).href,
      token_endpoint: new URL('token/', ISSUER).href,
      id_token_signing_alg_values_supported: ['RS256'],
    })
  }

  if (url.pathname.endsWith('/token/')) {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: ISSUER,
      sub: 'oidc-callback-user',
      aud: CLIENT_ID,
      iat: now,
      exp: now + 300,
      nonce,
      email: 'ada@example.test',
    }

    return Response.json({
      access_token: 'not-a-real-access-token',
      token_type: 'Bearer',
      expires_in: 300,
      id_token: `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.c2ln`,
    })
  }

  return new Response(null, { status: 404 })
}

before(async () => {
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))

    if (url.href.startsWith(ISSUER)) {
      return Promise.resolve(issuerAnswer(url))
    }

    return realFetch(input, init)
  }

  api = await startApi({
    AUTH_MODE: 'oidc',
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: 'not-a-real-secret',
  })
})

after(async () => {
  globalThis.fetch = realFetch
  await api.close()
})

// Decided at the callback, not asked for by the client: the login below sends no `remember`, as
// the portal's own sign-in never does, and a tab left in the background for a day would
// otherwise find its session gone.
test('a login through the issuer opens a session with the long window', async () => {
  const login = await api.request('/api/auth/login')
  assert.equal(login.status, 302)

  const authorize = new URL(login.headers.get('location') ?? '')
  const state = authorize.searchParams.get('state') ?? ''
  nonce = authorize.searchParams.get('nonce') ?? ''

  const callback = await api.request(
    `/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
  )
  assert.equal(callback.status, 302, await callback.clone().text())
  assert.equal((await api.request('/api/auth/me')).status, 200)

  const { getDb } = await import('#db/index.js')
  const { config } = await import('#config.js')

  const row = getDb()
    .prepare(
      `SELECT s.remember, (julianday(s.expires_at) - julianday('now')) * 86400 AS seconds
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE u.subject = 'oidc-callback-user'`,
    )
    .get() as { remember: number; seconds: number }

  assert.equal(row.remember, 1, 'the session would roll by the default window')
  assert.ok(
    Math.abs(row.seconds - config.session.rememberMaxAgeMs / 1000) <= 2,
    `${Math.round(row.seconds)}s left`,
  )
})
