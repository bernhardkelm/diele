import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiEntries } from '@diele/common'
import { startApi, type TestApi } from '#testing/harness.js'
import type { DB } from '#db/index.js'

let api: TestApi
let db: DB

/**
 * Writes a connector and one entry straight into the database, so the route has something to
 * serve without a sync having to reach a real source.
 * @param {string} label - Connector label
 * @returns {{ connectorId: number; ref: string }} - What the tests address the entry by
 */
function seedEntry(label: string): { connectorId: number; ref: string } {
  const { id } = db
    .prepare(
      `INSERT INTO connectors (type, label, config, sync_interval_s, position, enabled)
       VALUES ('gitlab', ?, '{}', 900, 1000, 1) RETURNING id`,
    )
    .get(label) as { id: number }

  const ref = `gitlab:${id}:project-1`

  db.prepare(
    `INSERT INTO connector_entries
       (connector_id, ref, kind, label, detail, url, keywords, actions, search_only)
     VALUES (?, ?, 'row', 'diele', 'example-group', 'https://gitlab.example/diele', '[]', '[]', 0)`,
  ).run(id, ref)

  db.prepare(
    `INSERT INTO connector_sync (connector_id, last_ok_at, next_run_at)
     VALUES (?, datetime('now'), datetime('now', '+15 minutes'))`,
  ).run(id)

  return { connectorId: id, ref }
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
  // After startApi, so this resolves the database the harness just pointed the config at.
  db = (await import('#db/index.js')).getDb()
})

after(async () => {
  await api.close()
})

test('entries need a session, the way the rest of the portal does', async () => {
  assert.equal((await api.request('/api/entries')).status, 401)
})

test('entries come back with the sources that produced them', async () => {
  await api.signIn()
  const { connectorId } = seedEntry('work')

  const payload = await api.get<ApiEntries>('/api/entries')

  assert.equal(payload.entries.length, 1)
  assert.equal(payload.entries[0]?.label, 'diele')
  assert.equal(payload.entries[0]?.connectorId, connectorId)

  const source = payload.sources.find((entry) => entry.connectorId === connectorId)
  assert.equal(source?.label, 'work')
  assert.equal(source?.type, 'gitlab')
  assert.equal(source?.mark, 'gl')
  assert.ok(source?.syncedAt)
})

// Hiding is a display preference rather than a permission: the lists that manage it have to
// show what is hidden in order to bring it back.
test('hiding an entry for yourself keeps it on the wire and records the preference', async () => {
  const { ref } = seedEntry('personal')

  const response = await api.request('/api/entries/hidden', {
    method: 'PUT',
    body: JSON.stringify({ ref, scope: 'mine', hidden: true }),
  })
  assert.equal(response.status, 200)

  const payload = await api.get<ApiEntries>('/api/entries')

  assert.ok(payload.entries.some((entry) => entry.ref === ref))
  assert.ok(payload.hidden.mine.includes(ref))
  // Nobody else's view changed, which is the whole difference between the two scopes.
  assert.equal(payload.hidden.all.includes(ref), false)
})

test('unhiding takes it back off the list', async () => {
  const { ref } = seedEntry('toggled')

  await api.request('/api/entries/hidden', {
    method: 'PUT',
    body: JSON.stringify({ ref, scope: 'mine', hidden: true }),
  })
  await api.request('/api/entries/hidden', {
    method: 'PUT',
    body: JSON.stringify({ ref, scope: 'mine', hidden: false }),
  })

  const payload = await api.get<ApiEntries>('/api/entries')
  assert.equal(payload.hidden.mine.includes(ref), false)
})

// Hiding something for yourself is what anyone signed in may do; hiding it for everyone is an
// administrative act, checked in the route rather than on the router.
test('hiding an entry for everyone is allowed for an account that may administer', async () => {
  const { ref } = seedEntry('for-everyone')

  const response = await api.request('/api/entries/hidden', {
    method: 'PUT',
    body: JSON.stringify({ ref, scope: 'all', hidden: true }),
  })
  assert.equal(response.status, 200)

  const payload = await api.get<ApiEntries>('/api/entries')
  assert.ok(payload.hidden.all.includes(ref))
  assert.equal(payload.hidden.mine.includes(ref), false)
})

test('a hidden body that is not one is refused', async () => {
  for (const body of [
    { ref: '', scope: 'mine', hidden: true },
    { ref: 'x', scope: 'everyone', hidden: true },
    { ref: 'x', scope: 'mine', hidden: 'yes' },
    { ref: 'x', scope: 'mine' },
  ]) {
    const response = await api.request('/api/entries/hidden', {
      method: 'PUT',
      body: JSON.stringify(body),
    })

    assert.equal(response.status, 400, JSON.stringify(body))
  }
})

// A sync error quotes the source's own response. On an instance pointed at an internal address
// that says which hosts and ports answer and how, so it is an admin's to read: everyone else
// gets told the section is stale, which is all they could act on anyway.
test('a sync error reaches an admin in full', async () => {
  const { connectorId } = seedEntry('failing-source')
  db.prepare(
    `INSERT INTO connector_sync (connector_id, last_error) VALUES (?, ?)
     ON CONFLICT (connector_id) DO UPDATE SET last_error = excluded.last_error`,
  ).run(connectorId, 'GitLab answered 403 for http://10.0.0.7:8080/api/v4/groups/ops')

  const payload = await api.get<ApiEntries>('/api/entries')
  const source = payload.sources.find((entry) => entry.connectorId === connectorId)

  assert.match(String(source?.error), /10\.0\.0\.7/)
})

test('the same error reaches everyone else without naming what answered', async () => {
  const { connectorId } = seedEntry('failing-for-everyone')
  db.prepare(
    `INSERT INTO connector_sync (connector_id, last_error) VALUES (?, ?)
     ON CONFLICT (connector_id) DO UPDATE SET last_error = excluded.last_error`,
  ).run(connectorId, 'GitLab answered 403 for http://10.0.0.7:8080/api/v4/groups/ops')

  db.prepare('UPDATE users SET is_admin = 0').run()

  const payload = await api.get<ApiEntries>('/api/entries')
  const source = payload.sources.find((entry) => entry.connectorId === connectorId)

  assert.equal(source?.error, 'this source could not be reached on its last run')
  assert.doesNotMatch(JSON.stringify(payload.sources), /10\.0\.0\.7/)

  db.prepare('UPDATE users SET is_admin = 1').run()
})

test('a source that is syncing cleanly carries no error either way', async () => {
  const { connectorId } = seedEntry('healthy-source')

  const payload = await api.get<ApiEntries>('/api/entries')
  const source = payload.sources.find((entry) => entry.connectorId === connectorId)

  assert.equal(source?.error, null)
})
