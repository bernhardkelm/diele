import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiConfig, ApiProviders, ApiUser } from '@diele/common'
import { startApi, type TestApi } from '#testing/harness.js'

let api: TestApi

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev', DIELE_VERSION: 'test-build' })
})

after(async () => {
  await api.close()
})

test('the status probe answers without a session, since that is what it is for', async () => {
  const response = await api.request('/status')

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok', version: 'test-build' })
})

// The portal is private but reachable from the open internet, and `robots.txt` is only read by a
// crawler that looks for one. Set before the gate, so it holds for the login screen too.
test('every response says it is not to be indexed', async () => {
  for (const path of ['/status', '/api/auth/providers', '/api/config']) {
    const response = await api.request(path)

    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', path)
  }
})

// Deny by default: the gate runs before every router, so this holds for routes nobody has
// written yet as much as for the ones that exist.
test('a route that is not on the public list refuses an anonymous caller', async () => {
  for (const path of ['/api/config', '/api/entries', '/api/admin/features']) {
    const response = await api.request(path)

    assert.equal(response.status, 401, path)
    assert.deepEqual(await response.json(), { error: 'authentication required' })
  }
})

test('the login screen can read the brand and the mode before anyone has signed in', async () => {
  const providers = await api.get<ApiProviders>('/api/auth/providers')

  assert.equal(providers.mode, 'dev')
  assert.deepEqual(providers.providers, [{ id: 'dev', name: 'Local Developer' }])
  assert.equal(typeof providers.brand.title, 'string')
  // Only local mode creates accounts here, so nothing is ever waiting to be claimed.
  assert.equal(providers.setupRequired, false)
})

test('signing in leaves a session the next request carries', async () => {
  const login = await api.request('/api/auth/login')
  assert.equal(login.status, 302)
  assert.equal(login.headers.get('location'), '/')

  const me = await api.get<ApiUser>('/api/auth/me')
  assert.equal(me.email, 'dev@localhost')
  assert.equal(me.name, 'Local Developer')
  // Accounts start as administrators, so the dev identity reaches the panel.
  assert.equal(me.canAdmin, true)
})

test('the cookie is http-only and lax, so script cannot read it and a cross-site form cannot send it', async () => {
  api.forgetCookies()
  const response = await api.request('/api/auth/login')
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith('diele_session='))

  assert.ok(cookie)
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /SameSite=Lax/i)
  assert.match(cookie, /Path=\//i)
})

test('the portal paints from one request once signed in', async () => {
  const payload = await api.get<ApiConfig>('/api/config')

  for (const key of ['brand', 'cards', 'sites', 'engines', 'commands', 'localhost', 'settings']) {
    assert.ok(key in payload, key)
  }
})

// Reachable only with a session: the gate runs first, so the same path is a 401 to an
// anonymous caller rather than an admission that nothing is there.
test('an unknown path answers 404 as json rather than express default html', async () => {
  const response = await api.request('/nope')

  assert.equal(response.status, 404)
  assert.equal(response.headers.get('content-type')?.startsWith('application/json'), true)
  assert.deepEqual(await response.json(), { error: 'not found' })
})

// A new tab page asks for this on every open, so an unchanged payload has to cost nothing.
test('an unchanged config answers 304 against its etag', async () => {
  const first = await api.request('/api/config')
  const etag = first.headers.get('etag')
  assert.ok(etag)

  assert.equal(await api.conditionalGet('/api/config', etag), 304)
})

// The payloads under /api are one account's own, so a proxy holding a copy would hand one
// person's portal to the next caller.
test('api responses are private and revalidated rather than heuristically cached', async () => {
  const response = await api.request('/api/config')

  assert.equal(response.headers.get('cache-control'), 'private, no-cache')
  assert.match(response.headers.get('vary') ?? '', /Cookie/i)
})

test('a write from another origin is refused even with a valid session', async () => {
  const response = await api.request('/api/admin/links/card', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: JSON.stringify({ label: 'x', url: 'https://x.test' }),
  })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'cross-origin request rejected' })
})

test('a body the schema rejects answers 400 with the issues, not 500', async () => {
  const response = await api.request('/api/admin/links/card', {
    method: 'POST',
    body: JSON.stringify({ label: '', url: 'javascript:alert(1)' }),
  })

  assert.equal(response.status, 400)

  const body = (await response.json()) as { error: string; details: unknown[] }
  assert.equal(body.error, 'invalid request')
  assert.ok(Array.isArray(body.details) && body.details.length > 0)
})

test('signing out ends the session on the server, not only in the browser', async () => {
  const logout = await api.request('/api/auth/logout', { method: 'POST' })
  assert.equal(logout.status, 200)
  assert.deepEqual(await logout.json(), { ok: true })

  const me = await api.request('/api/auth/me')
  assert.equal(me.status, 401)
})

test('logging out without a session is not an error, so a stale tab can still clear itself', async () => {
  const response = await api.request('/api/auth/logout', { method: 'POST' })

  assert.equal(response.status, 200)
})

test('a login carries the narrowed target through to the redirect', async () => {
  const allowed = await api.request('/api/auth/login?redirect=%2Fsettings')
  assert.equal(allowed.headers.get('location'), '/settings')

  const refused = await api.request('/api/auth/login?redirect=%2F%2Fevil.example')
  assert.equal(refused.headers.get('location'), '/')
})
