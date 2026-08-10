import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { replaceEntries } from '#connectors/entries.js'
import { linkRef } from '#connectors/refs.js'
import { createConnector } from '#connectors/repository.js'
import type { HealthReading, HealthRequest } from '#connectors/types.js'
import { getDb } from '#db/index.js'
import { readHealth, resetHealth } from '#health/cache.js'
import { writeBinding } from '#health/repository.js'
import { listProviderTasks } from '#health/resolve.js'
import { createLink } from '#links/repository.js'

// What the fake decorator was asked and what it answers, rewritten per test. GitLab is the type
// it stands in for: the registry is an allowlist, so a connector row has to name a real module,
// and this test is about the resolver rather than about any particular source.
let asked: ReadonlyArray<HealthRequest> = []
let answer: ReadonlyMap<string, HealthReading> | Error = new Map()

/**
 * Stands a decorator up on the GitLab module for the length of this file.
 * @returns {Promise<void>}
 */
async function stubModule(): Promise<void> {
  const { gitlabModule } = await import('#connectors/gitlab/module.js')

  Object.defineProperty(gitlabModule, 'resolveHealth', {
    configurable: true,
    value: (_context: unknown, requests: ReadonlyArray<HealthRequest>) => {
      asked = requests

      if (answer instanceof Error) {
        return Promise.reject(answer)
      }

      return Promise.resolve(answer)
    },
  })
}

/**
 * Creates a card to bind against.
 * @param {string} label - Name to tell it apart by
 * @param {string} url - Where it points
 * @returns {string} - Its ref
 */
function card(label: string, url: string): string {
  return createLink({ kind: 'card', label, url, keywords: [] }).ref
}

/**
 * Creates a connector to bind against.
 * @returns {number} - Its id
 */
function connector(): number {
  return createConnector({
    type: 'gitlab',
    label: 'decorator',
    config: { baseUrl: 'https://gitlab.com', groups: ['g'], includeSubgroups: true },
    syncIntervalSeconds: 60,
  }).id
}

beforeEach(async () => {
  const db = getDb()
  db.prepare('DELETE FROM health_bindings').run()
  db.prepare('DELETE FROM links').run()
  db.prepare('DELETE FROM connectors').run()

  resetHealth()
  asked = []
  answer = new Map()

  await stubModule()
})

test('one task per provider, however many entries are bound to it', () => {
  const id = connector()
  const first = card('One', 'https://one.example')
  const second = card('Two', 'https://two.example')
  const third = card('Three', 'https://three.example')

  writeBinding({ ref: first, provider: 'http', connectorId: null, selector: null })
  writeBinding({ ref: second, provider: 'gitlab', connectorId: id, selector: 'a' })
  writeBinding({ ref: third, provider: 'gitlab', connectorId: id, selector: 'b' })

  const tasks = listProviderTasks()

  assert.deepEqual(tasks.map((task) => task.key).sort(), ['gitlab:' + id, 'http'])
  assert.equal(tasks.find((task) => task.key === `gitlab:${id}`)?.refs.length, 2)
})

test('a binding whose target has gone away is left out', () => {
  const id = connector()
  writeBinding({ ref: linkRef('card', 9999), provider: 'gitlab', connectorId: id, selector: 'a' })

  assert.deepEqual(listProviderTasks(), [])
})

test('a binding on a connector that is off is left out', () => {
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'a' })

  getDb().prepare('UPDATE connectors SET enabled = 0 WHERE id = ?').run(id)

  assert.deepEqual(listProviderTasks(), [])
})

test('the module is handed the entry’s url and label alongside the selector', async () => {
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'chosen' })

  await listProviderTasks()[0]?.run()

  assert.deepEqual(asked, [{ ref, url: 'https://one.example', label: 'One', selector: 'chosen' }])
})

// The fallback that lets a monitor named after a repo path decorate it with nothing typed twice.
test('an entry with no selector of its own falls back to what produced it', async () => {
  const id = connector()
  replaceEntries(id, 'gitlab', [
    {
      localRef: 'repo:1',
      kind: 'row',
      label: 'web',
      url: 'https://gitlab.com/group/web',
      healthRef: 'group/web',
    },
  ])

  const ref = `gitlab:${id}:repo:1`
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: null })

  await listProviderTasks()[0]?.run()

  assert.equal(asked[0]?.selector, 'group/web')
})

test('a reading the module returned is served', async () => {
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'a' })
  answer = new Map([[ref, { state: 'up', detail: 'the monitor' }]])

  readHealth(true)
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.deepEqual(readHealth(true).readings[ref], { state: 'up', detail: 'the monitor' })
})

// A monitor name says which internal hosts exist and how they answer, the same reason a sync
// error is narrowed in the entries route.
test('the source’s own description is an admin’s to read', async () => {
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'a' })
  answer = new Map([[ref, { state: 'up', detail: 'internal-box-7' }]])

  readHealth(false)
  await new Promise((resolve) => setTimeout(resolve, 20))

  const reading = readHealth(false).readings[ref]

  assert.equal(reading?.state, 'up')
  assert.equal(reading?.detail, undefined)
})

// Not `down`, which is a claim about the service, and not nothing either: a dot that vanishes is
// how a decorator stops working without anyone noticing.
test('a source that throws marks what it watches unknown rather than down', async () => {
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'a' })
  answer = new Error('fetch failed (ECONNREFUSED)')

  readHealth(true)
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.deepEqual(readHealth(true).readings[ref], {
    state: 'unknown',
    detail: 'fetch failed (ECONNREFUSED)',
  })
})

// The message quotes the source's own response, which on an internal instance names hosts and
// ports, the same reason a monitor name is narrowed.
test('why the source could not be reached is an admin’s to read', async () => {
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'a' })
  answer = new Error('connect ECONNREFUSED 10.1.0.4:9500')

  readHealth(false)
  await new Promise((resolve) => setTimeout(resolve, 20))

  const reading = readHealth(false).readings[ref]

  assert.equal(reading?.state, 'unknown')
  assert.equal(reading?.detail, undefined)
})

test('an entry the source did not answer for loses its dot rather than keeping the last one', async () => {
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'a' })

  answer = new Map([[ref, { state: 'up' }]])
  readHealth(true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(readHealth(true).readings[ref]?.state, 'up')

  answer = new Map()
  resetHealth()
  readHealth(true)
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(readHealth(true).readings[ref], undefined)
})

// A cold portal would otherwise show no dots for a full minute after the first paint, which is
// most of the time a new tab is open.
test('a portal whose sources have not answered yet is told to come back sooner', async () => {
  const ref = card('One', 'https://127.0.0.1:1')
  writeBinding({ ref, provider: 'http', connectorId: null, selector: null })

  assert.equal(readHealth(true).pollSeconds, 5)

  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.equal(readHealth(true).pollSeconds, 60)
})

test('nothing is resolved at all while the feature is switched off', async () => {
  const { setEnabled } = await import('#settings/toggles.js')
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'http', connectorId: null, selector: null })

  setEnabled('health', false)
  assert.deepEqual(listProviderTasks(), [])

  setEnabled('health', true)
  assert.equal(listProviderTasks().length, 1)
})

// Switched off is not the same as nothing bound. The sweep that drops readings nothing is bound
// to any more would otherwise empty the cache the moment the switch is flipped, and the interval
// having not elapsed then leaves the portal blank for a full minute after it is flipped back.
test('switching the feature off and back on does not cost a minute of blank dots', async () => {
  const { setEnabled } = await import('#settings/toggles.js')
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'a' })
  answer = new Map([[ref, { state: 'up' }]])

  readHealth(true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(readHealth(true).readings[ref]?.state, 'up')

  setEnabled('health', false)
  assert.deepEqual(readHealth(true).readings, {})

  setEnabled('health', true)
  assert.equal(readHealth(true).readings[ref]?.state, 'up')
})

/**
 * Reads what the panel shows about a connector's last run.
 * @param {number} id - Connector to read
 * @returns {{ last_ok_at: string | null; last_error: string | null }} - Its recorded state
 */
function recorded(id: number): { last_ok_at: string | null; last_error: string | null } {
  return getDb()
    .prepare('SELECT last_ok_at, last_error FROM connector_sync WHERE connector_id = ?')
    .get(id) as { last_ok_at: string | null; last_error: string | null }
}

// A decorator runs no sync, so this is the only thing that ever says one is working, and the
// panel would otherwise call it `never synced` for as long as it existed.
test('a decorator that answered is recorded as read', async () => {
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'a' })

  assert.equal(recorded(id).last_ok_at, null)

  await listProviderTasks()[0]?.run()

  assert.notEqual(recorded(id).last_ok_at, null)
  assert.equal(recorded(id).last_error, null)
})

// A dot that quietly stopped appearing says nothing on its own, so the reason is kept where the
// panel can show it.
test('a decorator that could not be reached records why', async () => {
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'a' })
  answer = new Error('fetch failed (ECONNREFUSED)')

  await listProviderTasks()[0]?.run()

  assert.equal(recorded(id).last_error, 'fetch failed (ECONNREFUSED)')
})

// The entries of the last good run keep being served through a failure, and the same is true of
// when it last worked: overwriting it would lose how long something has been broken.
test('a failure leaves the last good read standing', async () => {
  const id = connector()
  const ref = card('One', 'https://one.example')
  writeBinding({ ref, provider: 'gitlab', connectorId: id, selector: 'a' })

  await listProviderTasks()[0]?.run()
  const wasOkAt = recorded(id).last_ok_at

  answer = new Error('gone')
  await listProviderTasks()[0]?.run()

  assert.equal(recorded(id).last_ok_at, wasOkAt)
  assert.equal(recorded(id).last_error, 'gone')
})
