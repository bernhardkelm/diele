import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HealthRequest } from '#connectors/types.js'
import { indexMonitors, readingFor } from '#connectors/uptimeKuma/map.js'
import { parseMonitors } from '#connectors/uptimeKuma/metrics.js'

// As Kuma writes it: the help line documents the codes, unset labels carry the literal `null`,
// and the endpoint carries metrics this only has to walk past.
const BODY = `# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)
# TYPE monitor_status gauge
monitor_status{monitor_name="Nextcloud",monitor_type="http",monitor_url="https://cloud.example.com",monitor_hostname="null",monitor_port="null"} 1
monitor_status{monitor_name="Grafana",monitor_type="http",monitor_url="https://grafana.example.com",monitor_hostname="null",monitor_port="null"} 0
monitor_status{monitor_name="Backup NAS",monitor_type="port",monitor_url="null",monitor_hostname="nas.example.com",monitor_port="445"} 2
monitor_status{monitor_name="Router",monitor_type="ping",monitor_url="null",monitor_hostname="10.0.0.1",monitor_port="null"} 3
# HELP monitor_response_time Monitor Response Time (ms)
# TYPE monitor_response_time gauge
monitor_response_time{monitor_name="Nextcloud",monitor_type="http",monitor_url="https://cloud.example.com"} 142
`

/**
 * Builds a request naming what the test is about.
 * @param {Partial<HealthRequest>} overrides - Fields to set
 * @returns {HealthRequest} - The request
 */
function request(overrides: Partial<HealthRequest> = {}): HealthRequest {
  return {
    ref: 'card:1',
    url: 'https://cloud.example.com',
    label: 'Cloud',
    ...overrides,
  }
}

test('every one of Kuma’s four states is read back', () => {
  const byName = new Map(parseMonitors(BODY).map((monitor) => [monitor.name, monitor.state]))

  assert.equal(byName.get('Nextcloud'), 'up')
  assert.equal(byName.get('Grafana'), 'down')
  assert.equal(byName.get('Backup NAS'), 'pending')
  assert.equal(byName.get('Router'), 'maintenance')
})

test('the other metrics on the same endpoint are walked past', () => {
  assert.equal(parseMonitors(BODY).length, 4)
})

test('a label Kuma wrote as the literal null is read as absent', () => {
  const nextcloud = parseMonitors(BODY).find((monitor) => monitor.name === 'Nextcloud')

  assert.equal(nextcloud?.url, 'https://cloud.example.com')
  assert.equal(nextcloud?.hostname, undefined)
})

test('an escaped quote in a monitor name survives', () => {
  const monitors = parseMonitors('monitor_status{monitor_name="the \\"main\\" box"} 1')

  assert.equal(monitors[0]?.name, 'the "main" box')
})

test('a status this build has no state for is left out rather than guessed at', () => {
  assert.deepEqual(parseMonitors('monitor_status{monitor_name="Odd"} 9'), [])
})

test('the binding’s own monitor name wins', () => {
  const lookups = indexMonitors(parseMonitors(BODY))

  // The url would resolve to Nextcloud, so answering Grafana proves the selector was read first
  assert.deepEqual(readingFor(request({ selector: 'Grafana' }), lookups), {
    state: 'down',
    detail: 'Grafana',
  })
})

test('an entry with no selector falls back to its hostname', () => {
  const lookups = indexMonitors(parseMonitors(BODY))

  assert.equal(readingFor(request(), lookups)?.state, 'up')
})

// A tcp or ping monitor carries a hostname where an http one carries a url.
test('a monitor without a url is still found by the host it watches', () => {
  const lookups = indexMonitors(parseMonitors(BODY))

  assert.equal(readingFor(request({ url: 'https://nas.example.com' }), lookups)?.state, 'pending')
})

test('an entry matching neither falls back to its own name', () => {
  const lookups = indexMonitors(parseMonitors(BODY))

  assert.equal(
    readingFor(request({ url: 'https://elsewhere.example', label: 'grafana' }), lookups)?.state,
    'down',
  )
})

// A monitor that does not exist is not a service that is down.
test('an entry nothing matches gets no reading at all', () => {
  const lookups = indexMonitors(parseMonitors(BODY))

  assert.equal(
    readingFor(request({ url: 'https://elsewhere.example', label: 'Elsewhere' }), lookups),
    undefined,
  )
})

// /metrics carries the current status and the response time, and none of Kuma's 24h arithmetic.
test('no uptime figure is invented', () => {
  const lookups = indexMonitors(parseMonitors(BODY))

  assert.equal(readingFor(request(), lookups)?.uptime, undefined)
})
