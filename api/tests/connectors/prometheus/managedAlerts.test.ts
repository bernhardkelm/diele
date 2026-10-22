import assert from 'node:assert/strict'
import { test } from 'node:test'
import { managedSignalsOf } from '#connectors/prometheus/managedAlerts.js'
import type { AlertMapping } from '#connectors/prometheus/signalRules.js'
import type { ManagedAlertRecord } from '#connectors/prometheus/client.js'

const BASE = 'https://alertmanager.example.com'

/** What an instance reports unless a case is about the floor itself. */
const MAPPING: AlertMapping = { connectorId: 7, baseUrl: BASE, floor: 'warning', hideWatchdog: true }

/**
 * Builds one alert as the v2 API sends it, active and critical unless told otherwise.
 * @param {Partial<ManagedAlertRecord>} overrides - What this case cares about
 * @returns {ManagedAlertRecord} - The alert
 */
function alert(overrides: Partial<ManagedAlertRecord> = {}): ManagedAlertRecord {
  return {
    status: { state: 'active' },
    labels: { alertname: 'PostgresDown', severity: 'critical', instance: 'db-01:9187' },
    startsAt: '2026-08-12T09:00:00Z',
    ...overrides,
  }
}

test('an active alert becomes a signal carrying its name and severity', () => {
  const [signal] = managedSignalsOf([alert()], MAPPING)

  assert.equal(signal?.label, 'PostgresDown')
  assert.equal(signal?.severity, 'critical')
  assert.equal(signal?.since, '2026-08-12T09:00:00Z')
})

// A silence is somebody saying they already know. The request asks for active alerts alone, so
// this is the backstop for an Alertmanager that ignored the query.
test('a suppressed alert never reaches the portal', () => {
  assert.deepEqual(managedSignalsOf([alert({ status: { state: 'suppressed' } })], MAPPING), [])
})

test('one it has not decided about yet is left alone', () => {
  assert.deepEqual(managedSignalsOf([alert({ status: { state: 'unprocessed' } })], MAPPING), [])
})

test('an alert carrying no status at all is not treated as active', () => {
  assert.deepEqual(managedSignalsOf([alert({ status: undefined })], MAPPING), [])
})

// The same filter the rule alerts get, since which road an alert arrived by says nothing about
// whether it is worth a line.
test('the portal’s filter applies here too', () => {
  const alerts = [
    alert({ labels: { alertname: 'Watchdog', severity: 'critical' } }),
    alert({ labels: { alertname: 'Chatty', severity: 'info' } }),
    alert({ labels: { severity: 'critical' } }),
  ]

  assert.deepEqual(managedSignalsOf(alerts, MAPPING), [])
})

// The floor is the source's setting rather than the road's, so an instance told to report info
// reports it whichever endpoint the alerts came from.
test('an info alert reaches the portal once the floor is lowered to it', () => {
  const alerts = [alert({ labels: { alertname: 'NtfyTestAlert', severity: 'info' } })]

  assert.deepEqual(managedSignalsOf(alerts, MAPPING), [])
  assert.equal(managedSignalsOf(alerts, { ...MAPPING, floor: 'info' })[0]?.label, 'NtfyTestAlert')
})

test('the link lands on the rule that fired rather than on the whole list', () => {
  const [signal] = managedSignalsOf(
    [alert({ generatorURL: 'https://prom.test/graph?g0.expr=up==0' })],
    MAPPING,
  )

  assert.equal(signal?.href, 'https://prom.test/graph?g0.expr=up==0')
})

test('an alert naming no rule of its own falls back to the Alertmanager', () => {
  assert.equal(managedSignalsOf([alert()], MAPPING)[0]?.href, `${BASE}/#/alerts`)
})

// An Alertmanager holds whatever was sent to it rather than only what its own Prometheus
// evaluates, so this field is a remote sender's word and it is rendered as a link on the portal's
// own page. A scheme a browser would execute must never survive into that href.
test('a javascript: generatorURL never becomes the link', () => {
  const [signal] = managedSignalsOf(
    [alert({ generatorURL: 'javascript:alert(document.cookie)' })],
    MAPPING,
  )

  assert.equal(signal?.href, `${BASE}/#/alerts`)
})

test('a data: generatorURL never becomes the link', () => {
  const [signal] = managedSignalsOf(
    [alert({ generatorURL: 'data:text/html,<script>alert(1)</script>' })],
    MAPPING,
  )

  assert.equal(signal?.href, `${BASE}/#/alerts`)
})

// Relative to whom is the question it cannot answer: the portal is not the source's origin, so a
// path resolves against the wrong host even where it is harmless.
test('a relative generatorURL falls back rather than resolving against the portal', () => {
  assert.equal(
    managedSignalsOf([alert({ generatorURL: '/graph?g0.expr=up' })], MAPPING)[0]?.href,
    `${BASE}/#/alerts`,
  )
})

test('a generatorURL of nothing but whitespace falls back', () => {
  assert.equal(managedSignalsOf([alert({ generatorURL: '   ' })], MAPPING)[0]?.href, `${BASE}/#/alerts`)
})

// The alert still reaches the portal: something firing must never be hidden because a link it
// carried was unusable.
test('an alert whose link was refused is still shown', () => {
  const [signal] = managedSignalsOf([alert({ generatorURL: 'javascript:alert(1)' })], MAPPING)

  assert.equal(signal?.label, 'PostgresDown')
  assert.equal(signal?.severity, 'critical')
})

// An alert pushed straight into the Alertmanager carries no generatorURL and no instance, which
// is exactly the shape a hand-triggered test alert arrives in.
test('an injected alert with only a name and a severity still shows', () => {
  const [signal] = managedSignalsOf(
    [
      {
        status: { state: 'active' },
        labels: { alertname: 'DieleSmokeTest', severity: 'critical' },
        startsAt: '2026-08-12T09:00:00Z',
      },
    ],
    MAPPING,
  )

  assert.equal(signal?.label, 'DieleSmokeTest')
  assert.equal(signal?.detail, undefined)
})

// The same condition read by either road keeps one identity, so filling the field in or clearing
// it does not re-key every line on the page.
test('the id matches what the rule alerts would have produced', async () => {
  const { signalsOf } = await import('#connectors/prometheus/alerts.js')

  const [managed] = managedSignalsOf([alert()], MAPPING)
  const [rule] = signalsOf(
    [
      {
        state: 'firing',
        labels: { alertname: 'PostgresDown', severity: 'critical', instance: 'db-01:9187' },
        activeAt: '2026-08-12T09:00:00Z',
      },
    ],
    { connectorId: 7, baseUrl: 'https://prometheus.example.com', floor: 'warning', hideWatchdog: true },
  )

  assert.equal(managed?.id, rule?.id)
})

// A label set carries the instance and the job, so the id is hashed rather than joined: it is
// rendered as a DOM key, and the topology is what the detail is kept from a non-admin for.
test('the id is a wide digest rather than the labels themselves', () => {
  const [signal] = managedSignalsOf([alert()], MAPPING)
  const [, digest] = signal?.id.split(':') ?? []

  assert.match(digest ?? '', /^[0-9a-f]{16}$/)
  assert.ok(!signal?.id.includes('db-01'))
})

test('the same labels keep one id, and different ones do not share it', () => {
  const [same] = managedSignalsOf([alert()], MAPPING)
  const [again] = managedSignalsOf([alert()], MAPPING)
  const [other] = managedSignalsOf(
    [alert({ labels: { alertname: 'PostgresDown', severity: 'critical', instance: 'db-02:9187' } })],
    MAPPING,
  )

  assert.equal(same?.id, again?.id)
  assert.notEqual(same?.id, other?.id)
})

// The lookup is a Map rather than an object literal, the key being a remote source's word: a
// plain literal answers for every name on the prototype.
for (const evil of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
  test(`a severity of ${evil} is not a severity`, () => {
    const alerts = [alert({ labels: { alertname: 'Odd', severity: evil } })]

    assert.deepEqual(managedSignalsOf(alerts, { ...MAPPING, floor: 'info' }), [])
  })
}
