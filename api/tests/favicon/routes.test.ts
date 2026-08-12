import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startApi, type TestApi } from '#tests/support/harness.js'

let api: TestApi

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev', BRAND_ACCENT_DARK: '#ff7043' })
})

after(async () => {
  await api.close()
})

// The login screen is part of the app the gate is protecting, and it carries an icon like every
// other page does.
test('the icons are served without a session', async () => {
  for (const path of [
    '/favicon/favicon.svg',
    '/favicon/favicon.ico',
    '/favicon/favicon-96x96.png',
    '/favicon/apple-touch-icon.png',
    '/favicon/web-app-manifest-192x192.png',
    '/favicon/web-app-manifest-512x512.png',
    '/favicon/site.webmanifest',
  ]) {
    const response = await api.request(path)

    assert.equal(response.status, 200, path)
    assert.ok((await response.arrayBuffer()).byteLength > 0, path)
  }
})

test('each is served under the type it was drawn as', async () => {
  const svg = await api.request('/favicon/favicon.svg')
  assert.match(svg.headers.get('content-type') ?? '', /image\/svg\+xml/)

  const png = await api.request('/favicon/apple-touch-icon.png')
  assert.match(png.headers.get('content-type') ?? '', /image\/png/)

  const manifest = await api.request('/favicon/site.webmanifest')
  assert.match(manifest.headers.get('content-type') ?? '', /application\/manifest\+json/)
})

test('they carry the accent this deployment is configured with', async () => {
  const response = await api.request('/favicon/favicon.svg')

  assert.match(await response.text(), /stroke="#ff7043"/)
})

// Short enough that a changed accent lands, long enough to spare the request on every
// navigation.
test('they may be held for a while but not forever', async () => {
  const response = await api.request('/favicon/favicon.svg')

  assert.match(response.headers.get('cache-control') ?? '', /max-age=\d+/)
  assert.doesNotMatch(response.headers.get('cache-control') ?? '', /immutable/)
})

test('a name that was never drawn is not answered from here', async () => {
  const response = await api.request('/favicon/nothing.png')

  assert.notEqual(response.status, 200)
})
