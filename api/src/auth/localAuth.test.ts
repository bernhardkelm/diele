import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiProviders, ApiUser } from '@diele/common'
import { startApi, type TestApi } from '#testing/harness.js'

const TOKEN = 'setup-token-for-this-test'
const USERNAME = 'ada'
const PASSWORD = 'a-long-enough-password'

let api: TestApi

/**
 * Reads the session cookie off a response as a `name=value` pair, so a test can present one
 * session while the client's own jar holds another.
 * @param {Response} response - Response that may carry a Set-Cookie
 * @returns {string | undefined} - The cookie header to send back, or undefined when none was set
 */
function sessionCookie(response: Response): string | undefined {
  const raw = response.headers.getSetCookie().find((value) => value.startsWith('diele_session='))

  return raw?.split(';')[0]
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'local', LOCAL_SETUP_TOKEN: TOKEN })
})

after(async () => {
  await api.close()
})

test('an unclaimed portal says so, without saying how the claim is guarded', async () => {
  const providers = await api.get<ApiProviders>('/api/auth/providers')

  assert.equal(providers.mode, 'local')
  assert.equal(providers.setupRequired, true)
  assert.deepEqual(providers.providers, [{ id: 'local', name: 'Password' }])
  assert.equal(JSON.stringify(providers).includes(TOKEN), false)
})

// Local mode has no handshake to begin, and this is a navigation target: answering with an
// error would strand whoever followed a stale link on a bare JSON page.
test('the login navigation bounces back to the portal rather than erroring', async () => {
  const response = await api.request('/api/auth/login?redirect=%2Fsettings')

  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), '/settings')
})

test('setup refuses a token that is not the one this portal printed', async () => {
  const response = await api.request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, token: 'wrong' }),
  })

  assert.equal(response.status, 403)
  assert.equal(
    await api.get<ApiProviders>('/api/auth/providers').then((p) => p.setupRequired),
    true,
  )
})

test('setup validates the account before it checks the token', async () => {
  const response = await api.request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ username: 'a', password: 'short', token: TOKEN }),
  })

  assert.equal(response.status, 400)
})

test('setup creates the first account and signs it in', async () => {
  const response = await api.request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, name: 'Ada', token: TOKEN }),
  })

  assert.equal(response.status, 201)

  const me = await api.get<ApiUser>('/api/auth/me')
  assert.equal(me.name, 'Ada')
  // The first account administers the portal, or nobody could configure it.
  assert.equal(me.canAdmin, true)
})

test('a claimed portal stops offering setup and refuses a second one', async () => {
  const providers = await api.get<ApiProviders>('/api/auth/providers')
  assert.equal(providers.setupRequired, false)

  const response = await api.request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ username: 'eve', password: PASSWORD, token: TOKEN }),
  })

  assert.equal(response.status, 403)
})

test('a password login opens a session', async () => {
  await api.request('/api/auth/logout', { method: 'POST' })
  assert.equal((await api.request('/api/auth/me')).status, 401)

  const response = await api.request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  })

  assert.equal(response.status, 200)
  assert.equal(await api.get<ApiUser>('/api/auth/me').then((me) => me.name), 'Ada')
})

// Normalised in one place, so `Ada` and `ada` are one account and one rate-limiter bucket
// rather than two of each.
test('the username is matched in its normalised form', async () => {
  const response = await api.request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: '  ADA  ', password: PASSWORD }),
  })

  assert.equal(response.status, 200)
})

// Ninety days is a long time for a credential nobody can see to revoke, which is what the
// previous session becomes the moment a second one replaces it.
test('signing in again ends the session it replaced', async () => {
  const signIn = (): Promise<Response> =>
    api.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    })

  const first = sessionCookie(await signIn())
  assert.ok(first)
  assert.equal((await api.request('/api/auth/me', { headers: { cookie: first } })).status, 200)

  const second = sessionCookie(await signIn())
  assert.ok(second)
  assert.notEqual(second, first)

  assert.equal((await api.request('/api/auth/me', { headers: { cookie: second } })).status, 200)
  assert.equal((await api.request('/api/auth/me', { headers: { cookie: first } })).status, 401)
})

test('a wrong password and an unknown username answer the same thing', async () => {
  const wrong = await api.request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USERNAME, password: 'not-the-password' }),
  })
  const unknown = await api.request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'nobody', password: 'not-the-password' }),
  })

  assert.equal(wrong.status, 401)
  assert.equal(unknown.status, 401)
  assert.deepEqual(await wrong.json(), await unknown.json())
})

test('a login body that is not one answers 400', async () => {
  const response = await api.request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USERNAME }),
  })

  assert.equal(response.status, 400)
})

// Last, because it deliberately fills the limiter for this address.
test('repeated failures are refused before the password is even checked', async () => {
  const attempt = (): Promise<Response> =>
    api.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'mallory', password: 'guess' }),
    })

  // The cap is on attempts already recorded, so the tenth still gets a real answer and the
  // eleventh is the one turned away.
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await attempt()).status, 401, `attempt ${i + 1}`)
  }

  const refused = await attempt()
  assert.equal(refused.status, 429)
  assert.equal(refused.headers.get('retry-after'), '900')
})
