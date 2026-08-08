import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiProviders } from '@diele/common'
import { startApi, type TestApi } from '#testing/harness.js'

// Reachable-looking but never actually reached: every test here is about what this app decides
// before or after talking to an issuer, which is where its own logic lives. The exchange itself
// belongs to openid-client, and reaching a real issuer over http is something the library
// refuses outright.
const ISSUER = 'https://sso.invalid/application/o/diele/'

let api: TestApi

before(async () => {
  api = await startApi({
    AUTH_MODE: 'oidc',
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: 'diele-test',
    OIDC_CLIENT_SECRET: 'not-a-real-secret',
    OIDC_DISPLAY_NAME: 'Test SSO',
  })
})

after(async () => {
  await api.close()
})

test('the login screen is told to offer the issuer, under the name it was given', async () => {
  const payload = await api.get<ApiProviders>('/api/auth/providers')

  assert.equal(payload.mode, 'oidc')
  assert.deepEqual(payload.providers, [{ id: 'oidc', name: 'Test SSO' }])
})

// Nothing here creates accounts, so neither of the local-mode endpoints may answer. Both are
// public, so this is what keeps a portal with an issuer from also holding its own passwords.
test('the password endpoints are refused outright in this mode', async () => {
  const login = await api.request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'ada', password: 'hunter2hunter2' }),
  })
  assert.equal(login.status, 400)

  const setup = await api.request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({
      username: 'ada',
      password: 'hunter2hunter2',
      token: 'whatever',
    }),
  })
  assert.equal(setup.status, 400)
})

// The account store is the issuer's, so there is no first account for this portal to create and
// nothing for a setup form to be offered for.
test('the portal never reports itself as waiting to be claimed', async () => {
  const payload = await api.get<ApiProviders>('/api/auth/providers')

  assert.equal(payload.setupRequired, false)
})

test('a callback carrying no state is refused', async () => {
  const response = await api.request('/api/auth/callback')

  assert.equal(response.status, 400)
  assert.match(((await response.json()) as { error: string }).error, /state/)
})

// The state is single-use and short-lived, so a replayed or expired callback has no handshake
// to consume. Without this a code could be presented against a handshake somebody else began.
test('a callback whose state matches no handshake is refused', async () => {
  const response = await api.request('/api/auth/callback?code=abc&state=never-issued')

  assert.equal(response.status, 400)
  assert.match(((await response.json()) as { error: string }).error, /unknown or expired/)
})

test('a callback cannot be talked into a session by state alone', async () => {
  await api.request('/api/auth/callback?code=abc&state=never-issued')
  const me = await api.request('/api/auth/me')

  assert.equal(me.status, 401)
})

// Everything below the auth router is behind the session gate, and this mode has no way to open
// one without the issuer. The portal is closed until it does.
test('nothing is readable while the issuer has not vouched for anyone', async () => {
  for (const path of ['/api/config', '/api/entries', '/api/admin/links/card']) {
    assert.equal((await api.request(path)).status, 401, path)
  }
})

// The local session is this app's to end, and it ends whether or not the issuer can be reached
// to end its own. Answering the error instead would leave the client believing it is still
// signed in while its cookie was already cleared.
test('signing out clears the session even when the issuer cannot be reached', async () => {
  const response = await api.request('/api/auth/logout', { method: 'POST' })

  assert.equal(response.status, 500)
  assert.match(
    response.headers.getSetCookie().join(' '),
    /diele_session=;/,
    'the cookie is cleared before the issuer is consulted',
  )
})
