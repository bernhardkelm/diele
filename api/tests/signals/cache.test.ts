import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createConnector } from '#connectors/repository.js'
import type { ConnectorContext, Signal } from '#connectors/types.js'
import { getDb } from '#db/index.js'
import { isLiveSignal, readSignals, resetSignals } from '#signals/cache.js'
import { listSignalTasks } from '#signals/resolve.js'

// What the stubbed source answers, rewritten per test. Prometheus is the type it stands in for
// because the registry is an allowlist, and this file is about the document rather than about
// reading any particular source.
/** Whoever the document is being read for; the silences are per person. */
const READER = 1

let answer: ReadonlyArray<Signal> | Error = []
let asked = 0

/**
 * Stands the source up on the Prometheus module for the length of this file.
 * @returns {Promise<void>}
 */
async function stubModule(): Promise<void> {
  const { prometheusModule } = await import('#connectors/prometheus/module.js')

  Object.defineProperty(prometheusModule, 'readSignals', {
    configurable: true,
    value: (_context: ConnectorContext) => {
      asked += 1

      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    },
  })
}

/**
 * Creates a connector for the stub to answer as.
 * @param {number} syncIntervalSeconds - How often it may be read
 * @returns {number} - Its id
 */
function connector(syncIntervalSeconds = 60): number {
  return createConnector({
    type: 'prometheus',
    label: 'metrics',
    config: { baseUrl: 'https://prometheus.example.com' },
    syncIntervalSeconds,
  }).id
}

/**
 * Builds one signal with only what the document reads.
 * @param {string} label - What is firing
 * @param {Signal['severity']} severity - How loud it is
 * @param {string | undefined} detail - The source's own description of it
 * @returns {Signal} - The signal
 */
function signal(label: string, severity: Signal['severity'], detail?: string): Signal {
  return { id: label, label, severity, ...(detail ? { detail } : {}) }
}

/**
 * Waits for the read the last call kicked off behind its answer.
 * @returns {Promise<void>}
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

beforeEach(async () => {
  getDb().prepare('DELETE FROM connectors').run()
  getDb().prepare('DELETE FROM signal_silences').run()

  resetSignals()
  answer = []
  asked = 0

  const { setEnabled } = await import('#settings/toggles.js')
  setEnabled('alerts', true)

  await stubModule()
})

test('what a source reports is served on the next read', async () => {
  connector()
  answer = [signal('PostgresDown', 'critical')]

  assert.deepEqual(readSignals(true, READER).signals, [])
  await settle()

  assert.equal(readSignals(true, READER).signals[0]?.label, 'PostgresDown')
})

// The detail quotes the alert's annotations, which name the instance that fired it.
test('the detail is an admin’s and the link is not', async () => {
  connector()
  answer = [
    {
      ...signal('PostgresDown', 'critical', 'the primary is not answering'),
      href: 'https://prometheus.example.com/alerts',
    },
  ]

  readSignals(false, READER)
  await settle()

  const asAdmin = readSignals(true, READER).signals[0]
  const asAnyone = readSignals(false, READER).signals[0]

  assert.equal(asAdmin?.detail, 'the primary is not answering')
  assert.equal(asAnyone?.detail, undefined)
  assert.equal(asAnyone?.href, 'https://prometheus.example.com/alerts')
})

// The funnel every signal leaves by, whichever module built it: a link composed out of what a
// remote source said would otherwise put whatever that source chose behind a click here.
test('a link a browser would execute is not served at all', async () => {
  connector()
  answer = [
    { ...signal('Pwn', 'critical'), href: 'javascript:alert(document.cookie)' },
    { ...signal('DiskFilling', 'warning'), href: 'https://prometheus.example.com/alerts' },
  ]

  readSignals(true, READER)
  await settle()

  const served = readSignals(true, READER).signals
  const refused = served.find((entry) => entry.label === 'Pwn')
  const kept = served.find((entry) => entry.label === 'DiskFilling')

  // The line is still there, it simply carries no link
  assert.equal(refused?.label, 'Pwn')
  assert.equal(refused?.href, undefined)
  assert.ok(refused !== undefined && !('href' in refused))

  assert.equal(kept?.href, 'https://prometheus.example.com/alerts')
})

test('two sources are merged into one list, worst first', async () => {
  connector()
  connector()
  answer = [signal('DiskFilling', 'warning'), signal('PostgresDown', 'critical')]

  readSignals(true, READER)
  await settle()

  assert.deepEqual(
    readSignals(true, READER).signals.map((entry) => entry.severity),
    ['critical', 'critical', 'warning', 'warning'],
  )
})

// A source being briefly unreachable is not everything having recovered, which is the one thing a
// quiet line must never mean.
test('a failed read keeps the last answer rather than reporting silence', async () => {
  connector()
  answer = [signal('PostgresDown', 'critical')]

  readSignals(true, READER)
  await settle()
  assert.equal(readSignals(true, READER).signals.length, 1)

  answer = new Error('connect ECONNREFUSED')
  resetSignals()
  readSignals(true, READER)
  await settle()

  assert.deepEqual(readSignals(true, READER).signals, [])
})

test('nothing is read at all while the feature is switched off', async () => {
  const { setEnabled } = await import('#settings/toggles.js')
  connector()

  setEnabled('alerts', false)
  assert.deepEqual(listSignalTasks(), [])

  readSignals(true, READER)
  await settle()

  assert.equal(asked, 0)

  setEnabled('alerts', true)
  assert.equal(listSignalTasks().length, 1)
})

// Switched off is not the same as nothing firing: the sweep that drops what no task owns would
// otherwise empty the cache the moment the switch is flipped, leaving the line blank for a full
// interval after it is flipped back.
test('switching the feature off and back on does not cost an interval of silence', async () => {
  const { setEnabled } = await import('#settings/toggles.js')
  connector()
  answer = [signal('PostgresDown', 'critical')]

  readSignals(true, READER)
  await settle()
  assert.equal(readSignals(true, READER).signals.length, 1)

  setEnabled('alerts', false)
  assert.deepEqual(readSignals(true, READER).signals, [])

  setEnabled('alerts', true)
  assert.equal(readSignals(true, READER).signals.length, 1)
})

test('a connector that is switched off stops being asked and loses its answer', async () => {
  const { setEnabled } = await import('#settings/toggles.js')
  connector()
  answer = [signal('PostgresDown', 'critical')]

  readSignals(true, READER)
  await settle()
  assert.equal(readSignals(true, READER).signals.length, 1)

  setEnabled('prometheus', false)

  assert.deepEqual(readSignals(true, READER).signals, [])

  setEnabled('prometheus', true)
})

// A cold portal would otherwise report nothing firing for a full minute after the first paint.
test('a portal whose sources have not answered yet is told to come back sooner', async () => {
  connector()

  assert.equal(readSignals(true, READER).pollSeconds, 5)

  await settle()

  assert.equal(readSignals(true, READER).pollSeconds, 60)
})

test('a source is not asked again inside its own interval', async () => {
  connector(900)

  readSignals(true, READER)
  await settle()
  readSignals(true, READER)
  await settle()

  assert.equal(asked, 1)
})

// What a source reports is decided as it is read, so an edit to those settings has to drop what
// the old ones produced. Left to lapse, a narrowed floor looks like it did not take until the
// interval comes round, which is a setting that appears not to work.
test('a source that was just edited is read again rather than served from before', async () => {
  const { forgetSource } = await import('#signals/cache.js')
  const id = connector(900)
  answer = [signal('PostgresDown', 'critical')]

  readSignals(true, READER)
  await settle()
  assert.equal(asked, 1)

  answer = []
  forgetSource(id)

  readSignals(true, READER)
  await settle()

  assert.equal(asked, 2)
  assert.deepEqual(readSignals(true, READER).signals, [])
})

// What bounds the silences: the id a caller sends is a key, and one nothing is firing writes a
// row the per-source sweep can never reach.
test('only what a source is reporting counts as a live signal', async () => {
  connector()
  answer = [signal('PostgresDown', 'critical')]

  // Nothing is held until a read has actually answered behind one
  assert.equal(isLiveSignal('PostgresDown'), false)

  readSignals(true, READER)
  await settle()

  assert.equal(isLiveSignal('PostgresDown'), true)
  assert.equal(isLiveSignal('made-up'), false)
  assert.equal(isLiveSignal('1:00000000'), false)
})

// A quietened line is still something the source is reporting, so it can still be brought back.
test('a silenced signal is still live, so it can be un-silenced', async () => {
  connector()
  answer = [signal('PostgresDown', 'critical')]

  readSignals(true, READER)
  await settle()
  readSignals(true, READER)

  const { setSilenced } = await import('#signals/silences.js')
  setSilenced('PostgresDown', READER, false, true)

  assert.equal(isLiveSignal('PostgresDown'), true)
})

// Served rather than filtered out, the way the entries serve what is hidden: a line nobody can
// see is a line nobody can bring back.
test('a quietened line is still served, marked in the scope that quietened it', async () => {
  connector()
  answer = [signal('PostgresDown', 'critical'), signal('DiskFilling', 'warning')]

  readSignals(true, READER)
  await settle()

  const { setSilenced } = await import('#signals/silences.js')
  setSilenced('PostgresDown', READER, false, true)

  const served = readSignals(true, READER)

  // Both are still in the document, which is what lets the client offer a way back. The quietened
  // one trails the firing half rather than holding its place, the cap falling on that half alone,
  // and the client reads the two apart by the ids below rather than by position.
  assert.deepEqual(
    served.signals.map((entry) => entry.label).sort(),
    ['DiskFilling', 'PostgresDown'],
  )

  assert.deepEqual(served.silenced.mine, ['PostgresDown'])
  assert.deepEqual(served.silenced.all, [])
})

// Only an admin may lift what the portal quietened, so which scope holds a line is what the
// client reads to decide whether to offer anyone a way back.
test('the portal’s own silences are served apart from a reader’s', async () => {
  connector()
  answer = [signal('PostgresDown', 'critical'), signal('DiskFilling', 'warning')]

  readSignals(true, READER)
  await settle()

  const { setSilenced } = await import('#signals/silences.js')
  setSilenced('PostgresDown', READER, true, true)
  setSilenced('DiskFilling', READER, false, true)

  const served = readSignals(true, READER)

  assert.deepEqual(served.silenced.all, ['PostgresDown'])
  assert.deepEqual(served.silenced.mine, ['DiskFilling'])
})

// Switched off is switched off: neither half is served, and nothing is read to build them.
test('the switch takes both halves of the document with it', async () => {
  connector()
  answer = [signal('PostgresDown', 'critical')]

  readSignals(true, READER)
  await settle()

  const { setEnabled } = await import('#settings/toggles.js')
  setEnabled('alerts', false)

  const served = readSignals(true, READER)

  assert.deepEqual(served.signals, [])
  assert.deepEqual(served.silenced.all, [])
  assert.deepEqual(served.silenced.mine, [])

  setEnabled('alerts', true)
})

// The list is collapsed behind a count and nothing past the first is reachable without opening
// it, so a source holding thousands would send rows nobody can read on every poll.
test('a source holding more than the cap sends the cap, and says how many there are', async () => {
  connector()
  answer = Array.from({ length: 250 }, (_, index) =>
    signal(`Alert${String(index).padStart(3, '0')}`, 'warning'),
  )

  readSignals(true, READER)
  await settle()

  const served = readSignals(true, READER)

  assert.equal(served.signals.length, 200)
  assert.equal(served.total, 250)
})

test('a source under the cap says exactly what it sent', async () => {
  connector()
  answer = [signal('PostgresDown', 'critical'), signal('DiskFilling', 'warning')]

  readSignals(true, READER)
  await settle()

  const served = readSignals(true, READER)

  assert.equal(served.signals.length, 2)
  assert.equal(served.total, 2)
})

// A quietened line dropped by the cap is one nobody could bring back, which is the whole reason
// the page is served them at all.
test('the cap never takes a quietened line with it', async () => {
  connector()
  answer = Array.from({ length: 250 }, (_, index) =>
    signal(`Alert${String(index).padStart(3, '0')}`, 'warning'),
  )

  readSignals(true, READER)
  await settle()

  const { setSilenced } = await import('#signals/silences.js')

  // One that sorts last, so it is well past where the cap falls
  setSilenced('Alert249', READER, false, true)

  const served = readSignals(true, READER)
  const labels = served.signals.map((entry) => entry.label)

  assert.ok(labels.includes('Alert249'))
  assert.deepEqual(served.silenced.mine, ['Alert249'])

  // The quietened one is no longer counted among what is firing
  assert.equal(served.total, 249)
})
