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
 * @returns {Promise<ReadonlyMap<string, HealthReading>>} - What it resolved
 */
function resolve(answer: () => Promise<Response>): Promise<ReadonlyMap<string, HealthReading>> {
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
    REQUESTS,
  )
}

// This module catches per query so one typo cannot take down every other card's dot, which used
// to mean an instance nobody could reach lost all of them silently instead.
test('a query that could not be run is unknown rather than no dot at all', async () => {
  const readings = await resolve(() => Promise.reject(new Error('fetch failed')))

  assert.deepEqual(readings.get('card:1'), { state: 'unknown', detail: 'fetch failed' })
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
