import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiConfig, ApiFeature } from '@diele/common'
import { startApi, type TestApi } from '#testing/harness.js'

let api: TestApi

/**
 * Reads the feature list and finds one by id.
 * @param {string} id - Feature to look for
 * @returns {Promise<ApiFeature>} - The feature, which the test asserts exists
 */
async function feature(id: string): Promise<ApiFeature> {
  const { features } = await api.get<{ features: ApiFeature[] }>('/api/admin/features')
  const found = features.find((entry) => entry.id === id)

  assert.ok(found, `no feature called ${id}`)
  return found
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
  await api.signIn()
})

after(async () => {
  await api.close()
})

test('every configurable feature is described in one list', async () => {
  const { features } = await api.get<{ features: ApiFeature[] }>('/api/admin/features')
  const ids = features.map((entry) => entry.id)

  for (const id of ['commands', 'engines', 'cards', 'sites', 'localhost', 'reddit']) {
    assert.ok(ids.includes(id), id)
  }
})

// Everything except the one that costs a request per load defaults on, so a fresh portal is not
// quietly missing behaviour it never said it had turned off. First in the file, because it is
// the only test that needs a portal nobody has toggled anything on yet.
test('a feature nobody has touched is on, except the one that probes the machine', async () => {
  const { features } = await api.get<{ features: ApiFeature[] }>('/api/admin/features')
  const enabled = new Map(features.map((entry) => [entry.id, entry.enabled]))

  for (const id of ['cards', 'sites', 'engines', 'reddit']) {
    assert.equal(enabled.get(id), true, id)
  }

  assert.equal(enabled.get('localhost'), false)
})

// Against an issuer the account list lives there, and offering to edit it here would promise
// something this process cannot do.
test('the users feature is absent unless the portal owns its accounts', async () => {
  const { features } = await api.get<{ features: ApiFeature[] }>('/api/admin/features')

  assert.equal(
    features.some((entry) => entry.id === 'users'),
    false,
  )
})

test('the counts follow the rows', async () => {
  const before = await feature('cards')

  await api.post('/api/admin/links/card', { label: 'Counted', url: 'https://counted.test' })

  const after = await feature('cards')
  assert.equal(after.count, before.count + 1)
  assert.equal(after.enabledCount, before.enabledCount + 1)
})

test('a count separates what exists from what is switched on', async () => {
  const { link } = await api.post<{ link: { id: number } }>('/api/admin/links/card', {
    label: 'Switched off',
    url: 'https://off.test',
  })

  const before = await feature('cards')

  await api.request(`/api/admin/links/card/${link.id}/enabled`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: false }),
  })

  const after = await feature('cards')
  assert.equal(after.count, before.count)
  assert.equal(after.enabledCount, before.enabledCount - 1)
})

// Turning a whole feature off is not the same as it having no rows: the rows stay and the
// portal stops asking for them.
test('switching a feature off empties its section without touching its rows', async () => {
  await api.post('/api/admin/links/card', { label: 'Still here', url: 'https://here.test' })

  const off = await api.request('/api/admin/features/cards/enabled', {
    method: 'PUT',
    body: JSON.stringify({ enabled: false }),
  })
  assert.equal(off.status, 200)

  assert.deepEqual((await api.get<ApiConfig>('/api/config')).cards, [])
  assert.equal((await feature('cards')).enabled, false)
  assert.ok((await feature('cards')).count > 0)

  await api.request('/api/admin/features/cards/enabled', {
    method: 'PUT',
    body: JSON.stringify({ enabled: true }),
  })

  assert.ok((await api.get<ApiConfig>('/api/config')).cards.length > 0)
})

// The built-in commands are how admin mode, the settings menu and signing out are reached, so
// a portal that could turn them off would have no way back in.
test('a feature with nothing to switch off refuses to be switched', async () => {
  for (const id of ['commands', 'users', 'nonsense']) {
    const response = await api.request(`/api/admin/features/${id}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    })

    assert.equal(response.status, 400, id)
    assert.deepEqual(await response.json(), { error: 'that feature cannot be turned off' })
  }
})

test('a toggle body that is not a boolean is refused', async () => {
  const response = await api.request('/api/admin/features/cards/enabled', {
    method: 'PUT',
    body: JSON.stringify({ enabled: 'no' }),
  })

  assert.equal(response.status, 400)
})
