import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import {
  runDueConnectors,
  startConnectorScheduler,
  stopConnectorScheduler,
} from '#connectors/scheduler.js'
import { getDb } from '#db/index.js'
import { createConnector } from './repository.js'

after(() => {
  stopConnectorScheduler()
})

// Started from the listen callback rather than at import, so importing the app in a test
// starts no timers. Whether one is running is visible in what holds the loop open.
test('starting the scheduler is idempotent', () => {
  startConnectorScheduler()
  const first = process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length

  startConnectorScheduler()
  const second = process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length

  assert.equal(second, first)
})

test('stopping it clears the timer, and stopping twice is not an error', () => {
  startConnectorScheduler()
  stopConnectorScheduler()

  assert.doesNotThrow(() => stopConnectorScheduler())
})

test('it can be started again after being stopped', () => {
  startConnectorScheduler()
  stopConnectorScheduler()

  assert.doesNotThrow(() => startConnectorScheduler())
  stopConnectorScheduler()
})

/**
 * Creates a connector that is already overdue, so the next tick picks it up.
 * @param {string} label - Name to tell it apart by
 * @param {number} overdueHours - How long it has been due, which is the order the tick takes them in
 * @returns {number} - Its id
 */
function overdueConnector(label: string, overdueHours: number): number {
  const { id } = createConnector({
    type: 'gitlab',
    label,
    config: { baseUrl: 'https://gitlab.invalid', groups: ['g'], includeSubgroups: true },
    syncIntervalSeconds: 900,
  })

  getDb()
    .prepare(
      `INSERT INTO connector_sync (connector_id, next_run_at)
       VALUES (?, datetime('now', ?))
       ON CONFLICT (connector_id) DO UPDATE SET next_run_at = excluded.next_run_at`,
    )
    .run(id, `-${overdueHours} hours`)

  return id
}

// `runSync` reads the connector before its own try block, so a row deleted between the tick's
// query and its turn in the queue throws there. Unhandled, that ends the process, since the tick
// is fired unawaited: everyone's portal goes down over a background job nobody was waiting on.
test('a connector deleted mid-tick neither crashes the tick nor stops the ones behind it', async () => {
  const first = overdueConnector('runs-first', 3)
  const deleted = overdueConnector('deleted-before-its-turn', 2)
  const last = overdueConnector('behind-the-gap', 1)

  const rejections: unknown[] = []
  const onRejection = (reason: unknown): void => {
    rejections.push(reason)
  }
  process.on('unhandledRejection', onRejection)

  // The tick runs serially and the first connector is already awaiting its collect, so the row is
  // gone by the time the second one is read.
  const running = runDueConnectors()
  getDb().prepare('DELETE FROM connectors WHERE id = ?').run(deleted)

  await assert.doesNotReject(running)
  await new Promise((resolve) => setImmediate(resolve))
  process.off('unhandledRejection', onRejection)

  assert.deepEqual(rejections, [])

  // Both sides of the gap were reached, which is what says the loop stepped over the missing row
  // rather than unwinding at it.
  for (const id of [first, last]) {
    const row = getDb()
      .prepare('SELECT last_error FROM connector_sync WHERE connector_id = ?')
      .get(id) as { last_error: string | null } | undefined

    assert.ok(row?.last_error, `connector ${id} was never run`)
  }
})
