import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiConfig, ApiLink } from '@diele/common'
import { startApi, type TestApi } from '#testing/harness.js'

type Row = ApiLink & { enabled: boolean }

let api: TestApi

/**
 * Adds a card and hands back the stored row.
 * @param {Partial<ApiLink>} overrides - Fields to set on top of a minimal valid card
 * @returns {Promise<ApiLink>} - The created link
 */
async function card(overrides: Record<string, unknown> = {}): Promise<ApiLink> {
  const body = { label: 'Grafana', url: 'https://grafana.test', ...overrides }
  const { link } = await api.post<{ link: ApiLink }>('/api/admin/links/card', body)

  return link
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
  await api.signIn()
})

after(async () => {
  await api.close()
})

test('a created card comes back with its id, ref and position', async () => {
  const link = await card({ label: 'First', keywords: ['metrics', 'dashboards'] })

  assert.equal(link.label, 'First')
  assert.equal(link.kind, 'card')
  assert.equal(link.ref, `card:${link.id}`)
  assert.deepEqual(link.keywords, ['metrics', 'dashboards'])
  assert.equal(typeof link.position, 'number')
})

// Cards and sites share one set of routes, so the path decides the section and cannot name a
// table that does not exist.
test('the kind comes from the path, not the body', async () => {
  const { link } = await api.post<{ link: ApiLink }>('/api/admin/links/site', {
    label: 'Docs',
    url: 'https://docs.test',
    kind: 'card',
  })

  assert.equal(link.kind, 'site')
})

test('an unknown kind is refused', async () => {
  for (const kind of ['widget', 'links', 'CARD']) {
    const response = await api.request(`/api/admin/links/${kind}`)

    assert.equal(response.status, 400, kind)
    assert.deepEqual(await response.json(), { error: 'kind must be card or site' })
  }
})

test('a url that is not http(s) is refused, since the portal hands it to the browser to open', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '/relative', '']) {
    const response = await api.request('/api/admin/links/card', {
      method: 'POST',
      body: JSON.stringify({ label: 'Bad', url }),
    })

    assert.equal(response.status, 400, url)
  }
})

test('a patch changes only what it names', async () => {
  const created = await card({ label: 'Before', display: 'old detail' })
  const { link } = await api
    .request(`/api/admin/links/card/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ label: 'After' }),
    })
    .then((r) => r.json() as Promise<{ link: ApiLink }>)

  assert.equal(link.label, 'After')
  assert.equal(link.url, created.url)
  assert.equal(link.display, 'old detail')
})

// A default survives `.partial()` as a value the parse fills in, so an empty body used to
// arrive as `{ keywords: [] }`: it passed the "at least one field" check and wiped the row's
// keywords on the way through.
test('an empty patch is refused rather than quietly clearing the fields it never named', async () => {
  const created = await card({ label: 'Keep', keywords: ['metrics', 'dashboards'] })

  const response = await api.request(`/api/admin/links/card/${created.id}`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 400)

  const { rows } = await api.get<{ rows: Row[] }>('/api/admin/links/card')
  assert.deepEqual(rows.find((row) => row.id === created.id)?.keywords, ['metrics', 'dashboards'])
})

test('an id that is not one is refused before any lookup', async () => {
  for (const id of ['abc', '0', '-1', '1.5']) {
    const response = await api.request(`/api/admin/links/card/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ label: 'x' }),
    })

    assert.equal(response.status, 400, id)
    assert.deepEqual(await response.json(), { error: 'id must be a positive integer' })
  }
})

test('patching a card that is not there answers 404', async () => {
  const response = await api.request('/api/admin/links/card/999999', {
    method: 'PATCH',
    body: JSON.stringify({ label: 'x' }),
  })

  assert.equal(response.status, 404)
})

// Switching a card off keeps the row, so the admin list still shows it and the portal does not.
test('a disabled card leaves the admin list but not the portal', async () => {
  const created = await card({ label: 'Hidden' })

  const off = await api.request(`/api/admin/links/card/${created.id}/enabled`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: false }),
  })
  assert.equal(off.status, 200)

  const { rows } = await api.get<{ rows: Row[] }>('/api/admin/links/card')
  assert.equal(rows.find((row) => row.id === created.id)?.enabled, false)

  const portal = await api.get<ApiConfig>('/api/config')
  assert.equal(
    portal.cards.some((entry) => entry.id === created.id),
    false,
  )
})

test('enabled has to be a boolean', async () => {
  const created = await card()

  for (const enabled of ['false', 0, null, undefined]) {
    const response = await api.request(`/api/admin/links/card/${created.id}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    })

    assert.equal(response.status, 400, String(enabled))
    assert.deepEqual(await response.json(), { error: 'enabled must be a boolean' })
  }
})

test('reordering rewrites positions into the order given', async () => {
  const a = await card({ label: 'order-a' })
  const b = await card({ label: 'order-b' })
  const c = await card({ label: 'order-c' })

  const response = await api.request('/api/admin/links/card/order', {
    method: 'PUT',
    body: JSON.stringify({ ids: [c.id, a.id, b.id] }),
  })
  assert.equal(response.status, 200)

  const { rows } = await api.get<{ rows: Row[] }>('/api/admin/links/card')
  const at = (id: number): number => rows.findIndex((row) => row.id === id)

  assert.ok(at(c.id) < at(a.id))
  assert.ok(at(a.id) < at(b.id))
})

test('a delete removes the row and a second one says it is gone', async () => {
  const created = await card({ label: 'Doomed' })

  assert.equal(
    (await api.request(`/api/admin/links/card/${created.id}`, { method: 'DELETE' })).status,
    200,
  )
  assert.equal(
    (await api.request(`/api/admin/links/card/${created.id}`, { method: 'DELETE' })).status,
    404,
  )
})

// The two sections are separate lists that happen to share a table, so a site is never returned
// by a request for cards.
test('cards and sites do not see each other', async () => {
  await card({ label: 'only-a-card' })
  await api.post('/api/admin/links/site', { label: 'only-a-site', url: 'https://site.test' })

  const cards = await api.get<{ rows: Row[] }>('/api/admin/links/card')
  const sites = await api.get<{ rows: Row[] }>('/api/admin/links/site')

  assert.ok(cards.rows.every((row) => row.kind === 'card'))
  assert.ok(sites.rows.every((row) => row.kind === 'site'))
  assert.ok(sites.rows.some((row) => row.label === 'only-a-site'))
  assert.ok(!cards.rows.some((row) => row.label === 'only-a-site'))
})
