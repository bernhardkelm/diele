import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiHealth, ApiRow } from '@diele/common'
import { startApi, type TestApi } from '#testing/harness.js'

let api: TestApi

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
})

after(async () => {
  await api.close()
})

// A dot is what everyone came for, so this is not admin-gated. What an admin gets on top is the
// `detail`, which is narrowed in the cache rather than here.
test('the readings need a session and nothing more', async () => {
  api.forgetCookies()
  assert.equal((await api.request('/api/health')).status, 401)

  await api.signIn()
  assert.equal((await api.request('/api/health')).status, 200)
})

test('a portal with nothing bound answers with nothing bound', async () => {
  await api.signIn()

  const payload = await api.get<ApiHealth>('/api/health')

  assert.deepEqual(payload.readings, {})
  assert.equal(typeof payload.pollSeconds, 'number')
  assert.ok(payload.pollSeconds > 0)
})

/**
 * Creates a card bound to the built-in probe.
 * @param {string} label - Name to tell it apart by
 * @param {string} healthPath - What to probe, a path or a whole url
 * @returns {Promise<ApiRow>} - The stored row, as the panel receives it
 */
async function boundCard(label: string, healthPath: string): Promise<ApiRow> {
  const { link } = await api.post<{ link: ApiRow }>('/api/admin/links/card', {
    label,
    url: api.url,
    keywords: [],
    health: 'http',
    healthPath,
  })

  return link
}

// The same thing a connector's save does with its token: say whether it works while the person
// who typed it is still looking at it.
test('a save answers with what the binding actually reports', async () => {
  await api.signIn()

  const up = await boundCard('Alive', '/status')
  assert.equal((up.healthReading as { state: string } | null)?.state, 'up')

  const down = await boundCard('Gone', '/nothing-is-here')
  assert.equal((down.healthReading as { state: string } | null)?.state, 'down')
})

// A service being down is a fact about the service, not a mistake in the binding, so unlike a
// connector's credentials this cannot refuse the save.
test('a binding that reports down is still stored', async () => {
  await api.signIn()
  const row = await boundCard('Down', '/nothing-is-here')

  const { rows } = await api.get<{ rows: ApiRow[] }>('/api/admin/links/card')
  const stored = rows.find((entry) => entry.id === row.id)

  assert.equal(stored?.health, 'http')
  assert.equal(stored?.healthPath, '/nothing-is-here')
})

test('the list carries the dot the portal draws, without reaching anything itself', async () => {
  await api.signIn()
  const row = await boundCard('Listed', '/status')

  const { rows } = await api.get<{ rows: ApiRow[] }>('/api/admin/links/card')
  const listed = rows.find((entry) => entry.id === row.id)

  assert.equal((listed?.healthReading as { state: string } | null)?.state, 'up')
})

test('an unbound row carries no reading at all', async () => {
  await api.signIn()
  const { link } = await api.post<{ link: ApiRow }>('/api/admin/links/card', {
    label: 'Unbound',
    url: api.url,
    keywords: [],
  })

  assert.equal(link.health, null)
  assert.equal(link.healthReading, null)
})

test('the row can be asked again on its own', async () => {
  await api.signIn()
  const row = await boundCard('Probed', '/status')

  const { link } = await api.post<{ link: ApiRow }>(`/api/admin/links/card/${row.id}/sync`)

  assert.equal((link.healthReading as { state: string } | null)?.state, 'up')
})

test('asking a row that is not there is refused rather than answered with nothing', async () => {
  await api.signIn()

  assert.equal(
    (await api.request('/api/admin/links/card/4242/sync', { method: 'POST' })).status,
    400,
  )
})
