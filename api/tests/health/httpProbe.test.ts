import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import type { HealthRequest } from '#connectors/types.js'
import { probeAll } from '#health/httpProbe.js'

let server: Server
let origin: string

/** What the next request should be answered with, set by each test. */
let answer: { status: number; location?: string; hangUp?: boolean } = { status: 200 }

before(async () => {
  server = createServer((req, res) => {
    if (answer.hangUp) {
      res.socket?.destroy()
      return
    }

    if (req.url === '/healthz') {
      res.writeHead(204).end()
      return
    }

    res.writeHead(answer.status, answer.location ? { location: answer.location } : {}).end('body')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/**
 * Probes one url and hands back the state alone.
 * @param {string} url - Where the entry points
 * @param {string | undefined} selector - Path the entry was bound with
 * @returns {Promise<string | undefined>} - The state, or undefined when there was no reading
 */
async function stateOf(url: string, selector?: string): Promise<string | undefined> {
  const request: HealthRequest = {
    ref: 'card:1',
    url,
    label: 'Test',
    ...(selector ? { selector } : {}),
  }

  return (await probeAll([request])).get('card:1')?.state
}

test('a 2xx is up', async () => {
  answer = { status: 200 }

  assert.equal(await stateOf(origin), 'up')
})

test('every other 2xx counts, not only 200', async () => {
  answer = { status: 204 }

  assert.equal(await stateOf(origin), 'up')
})

test('a 4xx and a 5xx are down', async () => {
  answer = { status: 404 }
  assert.equal(await stateOf(origin), 'down')

  answer = { status: 503 }
  assert.equal(await stateOf(origin), 'down')
})

// The single most common way for a service to look alive while answering nothing, and the whole
// reason this runs here rather than in the browser, where the status would be unreadable.
test('a redirect to a login page is down rather than followed', async () => {
  answer = { status: 302, location: '/login' }

  assert.equal(await stateOf(origin), 'down')
})

test('a refused connection is down', async () => {
  // Port 1 on loopback, which nothing is listening on
  assert.equal(await stateOf('http://127.0.0.1:1'), 'down')
})

// A hang-up rather than a stall: the two share the probe's failure path, and waiting out the
// real deadline would cost the suite five seconds to reach the same branch.
test('a connection dropped mid-request is down', async () => {
  answer = { status: 200, hangUp: true }

  assert.equal(await stateOf(origin), 'down')
  answer = { status: 200 }
})

test('the bound path is resolved against the entry’s own url', async () => {
  answer = { status: 500 }

  // The root is answering 500, so a 204 here can only have come from /healthz
  assert.equal(await stateOf(`${origin}/somewhere`, '/healthz'), 'up')
})

// What an address only this server can reach needs: the card points at the public url, the probe
// goes somewhere else entirely.
test('a whole url in the selector replaces the entry’s own rather than resolving under it', async () => {
  answer = { status: 500 }

  assert.equal(await stateOf('https://public.example.test', `${origin}/healthz`), 'up')
})

test('a path that is not a url leaves the entry down rather than throwing', async () => {
  assert.equal(await stateOf('not-a-url', '/healthz'), 'down')
})

// The base is always http(s), but an absolute selector is free text and could name any scheme.
test('a selector naming a scheme this cannot probe is refused rather than handed to fetch', async () => {
  for (const selector of ['file:///etc/passwd', 'ftp://example.test/x']) {
    assert.equal(await stateOf(origin, selector), 'down', selector)
  }
})

test('every entry is probed, and each answers for itself', async () => {
  answer = { status: 200 }

  const readings = await probeAll([
    { ref: 'card:1', url: origin, label: 'One' },
    { ref: 'card:2', url: 'http://127.0.0.1:1', label: 'Two' },
  ])

  assert.equal(readings.get('card:1')?.state, 'up')
  assert.equal(readings.get('card:2')?.state, 'down')
})
