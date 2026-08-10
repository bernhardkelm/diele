import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { fetchMetrics } from '#connectors/uptimeKuma/client.js'

const BODY = 'monitor_status{monitor_name="nextcloud"} 1'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

/**
 * Answers every request with one response, recording the headers it was given.
 * @param {Response} response - What to answer with
 * @param {Array<Headers>} seen - Collects the headers of each call
 * @returns {void}
 */
function stub(response: Response, seen: Array<Headers> = []): Array<Headers> {
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    seen.push(new Headers(init?.headers))
    return Promise.resolve(response.clone())
  }) as typeof fetch

  return seen
}

// An instance with auth disabled serves its metrics to anyone, and sending an empty Basic header
// at one that does want a key would be refused for the wrong reason.
test('no key means no authorization header at all', async () => {
  const seen = stub(new Response(BODY))

  await fetchMetrics('https://uptime.test', undefined, AbortSignal.timeout(1000))

  assert.equal(seen[0]?.has('authorization'), false)
})

test('a key is sent as basic auth with an empty username', async () => {
  const seen = stub(new Response(BODY))

  await fetchMetrics('https://uptime.test', 'uk1_secret', AbortSignal.timeout(1000))

  assert.equal(
    seen[0]?.get('authorization'),
    `Basic ${Buffer.from(':uk1_secret').toString('base64')}`,
  )
})

// The two refusals are not the same thing to act on: one is a wrong key, the other an instance
// that wants one at all.
test('a refusal without a key says the instance wants one, with its status', async () => {
  stub(new Response('no', { status: 401 }))

  await assert.rejects(
    () => fetchMetrics('https://uptime.test', undefined, AbortSignal.timeout(1000)),
    { message: 'this instance wants an API key (401)' },
  )
})

test('a refusal with a key says the key was rejected, with its status', async () => {
  stub(new Response('no', { status: 403 }))

  await assert.rejects(
    () => fetchMetrics('https://uptime.test', 'uk1_secret', AbortSignal.timeout(1000)),
    { message: 'the API key was rejected (403)' },
  )
})

test('any other status is named by its number', async () => {
  stub(new Response('no', { status: 502 }))

  await assert.rejects(
    () => fetchMetrics('https://uptime.test', undefined, AbortSignal.timeout(1000)),
    { message: 'Uptime Kuma answered 502 for its metrics' },
  )
})
