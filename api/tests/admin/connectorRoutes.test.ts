import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startApi, type TestApi } from '#tests/support/harness.js'
import type { DB } from '#db/index.js'

let api: TestApi
let db: DB

interface AdminRow {
  id: number
  label: string
  enabled: boolean
}

/**
 * Writes a connector straight into the database, so these tests do not need a source to answer.
 * @param {string} type - Connector type the row claims to be
 * @param {string} label - Name to tell it apart by
 * @returns {number} - Its id
 */
function seedConnector(type: string, label: string): number {
  const { id } = db
    .prepare(
      `INSERT INTO connectors (type, label, config, sync_interval_s, position, enabled)
       VALUES (?, ?, '{}', 900, 1000, 1) RETURNING id`,
    )
    .get(type, label) as { id: number }

  return id
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
  await api.signIn()
  db = (await import('#db/index.js')).getDb()
})

after(async () => {
  await api.close()
})

// A type nothing is registered for is a bad request rather than a missing row: the path names a
// module this build does not carry, not a connector somebody deleted.
// A type nothing is registered for is a bad request rather than a missing row: the path names a
// module this build does not carry, not a connector somebody deleted.
test('a type nothing is registered for is refused', async () => {
  assert.equal((await api.request('/api/admin/connectors/nosuch')).status, 400)

  const deleted = await api.request('/api/admin/connectors/nosuch/1', { method: 'DELETE' })
  assert.equal(deleted.status, 400)
})

test('the listing carries only the connectors of the type asked for', async () => {
  seedConnector('gitlab', 'work')
  seedConnector('made-up', 'not-a-real-module')

  const { rows } = await api.get<{ rows: AdminRow[] }>('/api/admin/connectors/gitlab')

  assert.deepEqual(
    rows.map((row) => row.label),
    ['work'],
  )
})

// The type decides which module handles the request, so a row reached through another type's
// route would be parsed and verified by the wrong module entirely.
test('a row cannot be deleted through a type it does not belong to', async () => {
  const id = seedConnector('made-up', 'belongs-elsewhere')

  const response = await api.request(`/api/admin/connectors/gitlab/${id}`, { method: 'DELETE' })
  assert.equal(response.status, 404)

  const still = db.prepare('SELECT id FROM connectors WHERE id = ?').get(id)
  assert.ok(still, 'the row was deleted through the wrong type')
})

test('a row cannot be switched off through a type it does not belong to', async () => {
  const id = seedConnector('made-up', 'switched-elsewhere')

  const response = await api.request(`/api/admin/connectors/gitlab/${id}/enabled`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: false }),
  })
  assert.equal(response.status, 404)

  const row = db.prepare('SELECT enabled FROM connectors WHERE id = ?').get(id) as {
    enabled: number
  }
  assert.equal(row.enabled, 1)
})

test('a row cannot be synced through a type it does not belong to', async () => {
  const id = seedConnector('made-up', 'synced-elsewhere')

  const response = await api.request(`/api/admin/connectors/gitlab/${id}/sync`, { method: 'POST' })

  assert.equal(response.status, 404)
})

test('a row of the right type is switched off through its own route', async () => {
  const id = seedConnector('gitlab', 'switchable')

  const response = await api.request(`/api/admin/connectors/gitlab/${id}/enabled`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: false }),
  })
  assert.equal(response.status, 200)

  const row = db.prepare('SELECT enabled FROM connectors WHERE id = ?').get(id) as {
    enabled: number
  }
  assert.equal(row.enabled, 0)
})

test('an id nothing is stored under is refused rather than answering emptily', async () => {
  const response = await api.request('/api/admin/connectors/gitlab/999999', { method: 'DELETE' })

  assert.equal(response.status, 404)
})

// Every one of these mutates, so none of them may answer to a caller without a session.
test('none of it is reachable without a session', async () => {
  api.forgetCookies()

  for (const [path, method] of [
    ['/api/admin/connectors/gitlab', 'GET'],
    ['/api/admin/connectors/gitlab/1', 'DELETE'],
    ['/api/admin/connectors/gitlab/1/sync', 'POST'],
  ] as const) {
    const response = await api.request(path, { method })
    assert.equal(response.status, 401, `${method} ${path}`)
  }

  await api.signIn()
})
