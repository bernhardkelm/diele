import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getDb } from '#db/index.js'
import { runSync } from '#connectors/sync.js'

/**
 * Adds a connector row of a given type, with the sync row a scheduler tick would look at.
 * @param {string} type - Connector type, which decides whether a module answers for it
 * @param {string} label - Label, which is what makes the row identifiable in a test
 * @returns {number} - Its id
 */
function connector(type: string, label: string): number {
  const { id } = getDb()
    .prepare(
      `INSERT INTO connectors (type, label, config, sync_interval_s, position)
       VALUES (?, ?, '{}', 900, 1000) RETURNING id`,
    )
    .get(type, label) as { id: number }

  return id
}

/**
 * Reads the sync bookkeeping for one connector.
 * @param {number} connectorId - Connector to read
 * @returns {Record<string, unknown>} - The row, or an empty object when there is none yet
 */
function syncRow(connectorId: number): Record<string, unknown> {
  return (getDb().prepare('SELECT * FROM connector_sync WHERE connector_id = ?').get(connectorId) ??
    {}) as Record<string, unknown>
}

// A type this build does not register cannot produce anything, and saying so is better than
// claiming the connector and failing inside the run.
test('a connector whose type produces no entries is refused before it is claimed', async () => {
  const id = connector('retired-type', 'unknown')

  const outcome = await runSync(id)

  assert.equal(outcome.ok, false)
  assert.equal(outcome.error, 'this connector produces no entries')
  assert.deepEqual(syncRow(id), {})
})

// Claiming is what stops a manual sync and the scheduler collecting one source twice at once.
test('a connector already running is not run a second time', async () => {
  const id = connector('gitlab', 'claimed')

  getDb()
    .prepare(`INSERT INTO connector_sync (connector_id, running_since) VALUES (?, datetime('now'))`)
    .run(id)

  const outcome = await runSync(id)

  assert.equal(outcome.ok, false)
  assert.equal(outcome.error, 'a sync is already running')
})

// A claim left behind by a process that died is not a claim, or the connector would never run
// again without someone clearing the row by hand.
test('a claim old enough to belong to a dead process is taken over', async () => {
  const id = connector('gitlab', 'stale-claim')

  getDb()
    .prepare(
      `INSERT INTO connector_sync (connector_id, running_since)
       VALUES (?, datetime('now', '-20 minutes'))`,
    )
    .run(id)

  const outcome = await runSync(id)

  // It gets as far as running, and then fails on the credentials it has none of, which is a
  // different answer from being turned away at the claim.
  assert.equal(outcome.ok, false)
  assert.notEqual(outcome.error, 'a sync is already running')
})

// The entries the last good run produced are deliberately left standing: a list a quarter of
// an hour old is closer to the truth than an empty section.
test('a failed run records the error, backs off, and releases the claim', async () => {
  const id = connector('gitlab', 'failing')

  const outcome = await runSync(id)
  assert.equal(outcome.ok, false)

  const row = syncRow(id)
  assert.equal(row.running_since, null)
  assert.equal(row.failures, 1)
  assert.ok(typeof row.last_error === 'string' && row.last_error.length > 0)
  assert.ok(row.next_run_at)
})

test('consecutive failures back off further each time', async () => {
  const id = connector('gitlab', 'backing-off')

  await runSync(id)
  const first = syncRow(id)

  await runSync(id)
  const second = syncRow(id)

  assert.equal(first.failures, 1)
  assert.equal(second.failures, 2)
  assert.ok(String(second.next_run_at) >= String(first.next_run_at))
})

// A connector that arrived through an import has no sync row yet, and without one the claim
// would match nothing and it would never run.
test('a connector with no sync row gets one rather than being skipped forever', async () => {
  const id = connector('gitlab', 'imported')

  assert.deepEqual(syncRow(id), {})

  await runSync(id)

  assert.ok(Object.keys(syncRow(id)).length > 0)
})
