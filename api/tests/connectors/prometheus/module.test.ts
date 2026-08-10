import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { prometheusModule } from '#connectors/prometheus/module.js'
import type { HealthReading, HealthRequest } from '#connectors/types.js'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const REQUESTS: ReadonlyArray<HealthRequest> = [
  { ref: 'card:1', url: 'https://x.test', label: 'x', selector: 'up' },
]

/**
 * Runs the module's health resolution against a stubbed instance.
 * @param {() => Promise<Response>} answer - What the query api does
 * @param {ReadonlyArray<HealthRequest>} requests - Entries to ask about, one card by default
 * @returns {Promise<ReadonlyMap<string, HealthReading>>} - What it resolved
 */
function resolve(
  answer: () => Promise<Response>,
  requests: ReadonlyArray<HealthRequest> = REQUESTS,
): Promise<ReadonlyMap<string, HealthReading>> {
  globalThis.fetch = (() => answer()) as typeof fetch

  return prometheusModule.resolveHealth!(
    {
      id: 1,
      label: 'metrics',
      config: { baseUrl: 'https://prom.test' },
      secrets: {},
      signal: AbortSignal.timeout(1000),
      cursor: null,
    },
    requests,
  )
}

// Raised rather than swallowed, so `recordHealthRead` marks the connector as failing. The dots
// themselves are not lost: `askConnector` turns this into `unknown` for every entry it asked about.
test('an instance nobody could reach is raised rather than read as healthy', async () => {
  await assert.rejects(
    () => resolve(() => Promise.reject(new Error('fetch failed'))),
    /no query could be run.*fetch failed/s,
  )
})

// The instance answered, so it is working and the expression is the thing that is wrong. Marking
// the connector failing over a typo would cry wolf on every later read.
test('an expression the instance refused leaves the connector reporting', async () => {
  const readings = await resolve(() =>
    Promise.resolve(
      new Response(JSON.stringify({ status: 'error', error: 'parse error: unexpected end' }), {
        status: 400,
      }),
    ),
  )

  assert.equal(readings.get('card:1')?.state, 'unknown')
})

// A token that was revoked answers 401 rather than failing to connect, and is just as broken.
test('a rejected token is raised the same way an unreachable instance is', async () => {
  await assert.rejects(
    () => resolve(() => Promise.resolve(new Response(null, { status: 401 }))),
    /no query could be run/,
  )
})

// One entry answering proves the instance is up, so the rest failing is not the connector's fault.
test('one query answering keeps a batch from being read as a dead instance', async () => {
  let call = 0

  const readings = await resolve(
    () => {
      call += 1

      if (call === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ status: 'success', data: { resultType: 'scalar', result: [1, '1'] } }),
          ),
        )
      }

      return Promise.reject(new Error('fetch failed'))
    },
    [
      { ref: 'card:1', url: 'https://x.test', label: 'x', selector: 'up' },
      { ref: 'card:2', url: 'https://y.test', label: 'y', selector: 'up' },
    ],
  )

  assert.equal(readings.get('card:1')?.state, 'up')
  assert.equal(readings.get('card:2')?.state, 'unknown')
})

// Prometheus says where the expression is wrong, which is the thing worth reading here.
test('an expression Prometheus refused carries its own explanation', async () => {
  const readings = await resolve(() =>
    Promise.resolve(
      new Response(JSON.stringify({ status: 'error', error: 'parse error: unexpected end' }), {
        status: 400,
      }),
    ),
  )

  assert.equal(readings.get('card:1')?.state, 'unknown')
  assert.match(String(readings.get('card:1')?.detail), /parse error/)
})

// A query the instance ran and answered nothing for is a mistake in the query, not an outage,
// and not the instance failing either.
test('a query matching nothing still leaves the dot off', async () => {
  const readings = await resolve(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } }),
      ),
    ),
  )

  assert.equal(readings.size, 0)
})

test('a value the instance returned is read as a state', async () => {
  const readings = await resolve(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ status: 'success', data: { resultType: 'scalar', result: [1, '0'] } }),
      ),
    ),
  )

  assert.equal(readings.get('card:1')?.state, 'down')
})
