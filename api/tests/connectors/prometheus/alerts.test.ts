import assert from 'node:assert/strict'
import { test } from 'node:test'
import { signalsOf } from '#connectors/prometheus/alerts.js'
import type { AlertMapping } from '#connectors/prometheus/signalRules.js'
import type { AlertRecord } from '#connectors/prometheus/client.js'

const BASE = 'https://prometheus.example.com'

/** What an instance reports unless a case is about the floor itself. */
const MAPPING: AlertMapping = { connectorId: 7, baseUrl: BASE, floor: 'warning', hideWatchdog: true }

/**
 * Builds one alert as the v1 API sends it, firing and critical unless told otherwise.
 * @param {Partial<AlertRecord>} overrides - What this case cares about
 * @returns {AlertRecord} - The alert
 */
function alert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    state: 'firing',
    labels: { alertname: 'PostgresDown', severity: 'critical', instance: 'db-01:9187' },
    activeAt: '2026-08-12T09:00:00Z',
    ...overrides,
  }
}

test('a firing alert becomes a signal carrying its name and severity', () => {
  const [signal] = signalsOf([alert()], MAPPING)

  assert.equal(signal?.label, 'PostgresDown')
  assert.equal(signal?.severity, 'critical')
  assert.equal(signal?.since, '2026-08-12T09:00:00Z')
  assert.equal(signal?.href, `${BASE}/alerts`)
})

// The one alert every stock install fires forever by design, to prove the alerting path works.
// Hidden by default at every floor, including the one that admits everything else.
test('Watchdog is dropped whatever case it is written in, and whatever the floor', () => {
  const alerts = [
    alert({ labels: { alertname: 'Watchdog', severity: 'critical' } }),
    alert({ labels: { alertname: 'watchdog', severity: 'critical' } }),
  ]

  assert.deepEqual(signalsOf(alerts, MAPPING), [])
  assert.deepEqual(signalsOf(alerts, { ...MAPPING, floor: 'info' }), [])
})

// Somebody who wants one place to see that the alerting path is alive is asking a fair question
// of exactly this alert.
test('Watchdog shows once it is asked for', () => {
  const shown = signalsOf([alert({ labels: { alertname: 'Watchdog', severity: 'none' } })], {
    ...MAPPING,
    hideWatchdog: false,
  })

  assert.equal(shown[0]?.label, 'Watchdog')
})

// The stock one is labelled `severity: none`, which is not a level at all. Read literally it
// would clear no floor, so the box that says to show it would never show it.
test('a heartbeat asked for clears the floor it could never have met', () => {
  const alerts = [alert({ labels: { alertname: 'Watchdog', severity: 'none' } })]
  const [signal] = signalsOf(alerts, { ...MAPPING, floor: 'critical', hideWatchdog: false })

  assert.equal(signal?.label, 'Watchdog')
  // Drawn as the quietest thing on the page: a pipeline being alive is not an incident.
  assert.equal(signal?.severity, 'info')
})

test('a severity the portal has no word for is left off rather than guessed at', () => {
  const alerts = [
    alert({ labels: { alertname: 'Unlabelled' } }),
    alert({ labels: { alertname: 'Odd', severity: 'page' } }),
  ]

  assert.deepEqual(signalsOf(alerts, { ...MAPPING, floor: 'info' }), [])
})

test('warning and critical both survive the default floor, however they are cased', () => {
  const alerts = [
    alert({ labels: { alertname: 'DiskFilling', severity: 'Warning' } }),
    alert({ labels: { alertname: 'PostgresDown', severity: 'CRITICAL' } }),
  ]

  assert.deepEqual(
    signalsOf(alerts, MAPPING).map((signal) => signal.severity),
    ['warning', 'critical'],
  )
})

// `pending` is a rule whose condition has held for less than its `for` clause, which is exactly
// the window its author asked not to be told about yet.
test('a pending alert is not yet firing', () => {
  assert.deepEqual(signalsOf([alert({ state: 'pending' })], MAPPING), [])
})

test('the detail quotes the annotation and the instance', () => {
  const [signal] = signalsOf(
    [alert({ annotations: { summary: 'the primary is not answering' } })],
    MAPPING,
  )

  assert.equal(signal?.detail, 'the primary is not answering (db-01:9187)')
})

test('a description stands in where there is no summary', () => {
  const [signal] = signalsOf([alert({ annotations: { description: 'no connections' } })], MAPPING)

  assert.equal(signal?.detail, 'no connections (db-01:9187)')
})

test('an alert with neither annotation nor instance carries no detail', () => {
  const [signal] = signalsOf(
    [alert({ labels: { alertname: 'Bare', severity: 'warning' } })],
    MAPPING,
  )

  assert.equal(signal?.detail, undefined)
})

// The id is what the client keys its rows on, so a line must not re-key while the same condition
// simply goes on holding.
test('the id is stable across polls and blind to label order', () => {
  const [first] = signalsOf([alert()], MAPPING)
  const [second] = signalsOf(
    [
      alert({
        labels: { instance: 'db-01:9187', severity: 'critical', alertname: 'PostgresDown' },
      }),
    ],
    MAPPING,
  )

  assert.equal(first?.id, second?.id)
})

test('the same alert on two instances is two signals', () => {
  const [first] = signalsOf([alert()], MAPPING)
  const [second] = signalsOf([alert()], { ...MAPPING, connectorId: 8 })

  assert.notEqual(first?.id, second?.id)
})

// A label set names the internal hosts, which is what the detail is kept from a non-admin for.
test('the id gives away none of the labels it was built from', () => {
  const [signal] = signalsOf([alert()], MAPPING)

  assert.ok(signal)
  assert.ok(!signal.id.includes('db-01'))
  assert.ok(!signal.id.includes('PostgresDown'))
})

test('an alert with no name at all is dropped rather than shown blank', () => {
  assert.deepEqual(signalsOf([alert({ labels: { severity: 'critical' } })], MAPPING), [])
})

test('the floor decides how far down the list is read', () => {
  const alerts = [
    alert({ labels: { alertname: 'PostgresDown', severity: 'critical' } }),
    alert({ labels: { alertname: 'DiskFilling', severity: 'warning' } }),
    alert({ labels: { alertname: 'CPUThrottlingHigh', severity: 'info' } }),
  ]

  /**
   * Names what survives one floor.
   * @param {AlertMapping['floor']} floor - Least severe level to report
   * @returns {ReadonlyArray<string>} - Alert names that reached the portal
   */
  const at = (floor: AlertMapping['floor']): ReadonlyArray<string> =>
    signalsOf(alerts, { ...MAPPING, floor }).map((signal) => signal.label)

  assert.deepEqual(at('critical'), ['PostgresDown'])
  assert.deepEqual(at('warning'), ['PostgresDown', 'DiskFilling'])
  assert.deepEqual(at('info'), ['PostgresDown', 'DiskFilling', 'CPUThrottlingHigh'])
})
