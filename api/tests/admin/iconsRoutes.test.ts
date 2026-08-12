import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiIcon, ApiLink } from '@diele/common'
import { startApi, type TestApi } from '#tests/support/harness.js'

const SQUARE = '<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>'

let api: TestApi

/**
 * Uploads an icon and hands back the stored row.
 * @param {string} name - Name shown in the picker
 * @returns {Promise<ApiIcon>} - The created icon
 */
async function icon(name = 'square'): Promise<ApiIcon> {
  const { icon: stored } = await api.post<{ icon: ApiIcon }>('/api/admin/icons', {
    name,
    svg: SQUARE,
  })

  return stored
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
  await api.signIn()
})

after(async () => {
  await api.close()
})

test('an uploaded icon is listed with the markup it was sanitised into', async () => {
  const stored = await icon('grafana')
  const { icons } = await api.get<{ icons: ReadonlyArray<ApiIcon> }>('/api/admin/icons')

  assert.ok(icons.some((entry) => entry.id === stored.id && entry.name === 'grafana'))
  assert.match(stored.svg, /^<svg/)
})

// The reference is cleared rather than the card deleted, which is what lets an icon be deleted
// at all: a card losing its logo is recoverable, a card disappearing is not.
test('deleting an icon keeps the card and clears its reference', async () => {
  const stored = await icon()
  const { link } = await api.post<{ link: ApiLink }>('/api/admin/links/card', {
    label: 'Grafana',
    url: 'https://grafana.test',
    iconId: stored.id,
  })

  assert.equal(link.iconId, stored.id)

  const response = await api.request(`/api/admin/icons/${stored.id}`, { method: 'DELETE' })
  assert.equal(response.status, 200)

  const { rows } = await api.get<{ rows: ReadonlyArray<ApiLink> }>('/api/admin/links/card')
  const after = rows.find((row) => row.id === link.id)

  assert.ok(after, 'the card is still there')
  assert.equal(after.iconId, null)
  assert.equal(after.icon, null)
})

test('deleting an icon that is not there is a 404', async () => {
  const response = await api.request('/api/admin/icons/4242', { method: 'DELETE' })

  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'icon not found' })
})
