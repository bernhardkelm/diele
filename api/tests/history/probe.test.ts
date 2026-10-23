import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, test } from 'node:test'
import { pageExists, pinnedLookup } from '#history/probe.js'

let server: Server
let origin: string

/** Every request the server saw, as method and path. */
let seen: string[] = []

/** The `Host` header of every request the server saw. */
let hosts: string[] = []

/** Where the test server listens, and so where every probe here is pinned to. */
const LOOPBACK = '127.0.0.1'

/** Lets the test server's loopback address through, which the default policy refuses. */
const anywhere = (): boolean => true

before(async () => {
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`)
    hosts.push(req.headers.host ?? '')
    const status = Number(req.url?.slice(1))

    if (req.url === '/hang') {
      res.socket?.destroy()
      return
    }

    if (req.url === '/no-head' && req.method === 'HEAD') {
      res.writeHead(405).end()
      return
    }

    if (status === 302) {
      res.writeHead(302, { location: '/404' }).end()
      return
    }

    res.writeHead(Number.isInteger(status) && status > 0 ? status : 200).end('body')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(() => {
  seen = []
  hosts = []
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// Existence, not liveness: a login wall in front of a real page is the ordinary case.
test('any answer but not found and gone says the page exists', async () => {
  for (const status of [200, 204, 302, 401, 403, 500, 503]) {
    assert.equal(await pageExists(`${origin}/${status}`, LOOPBACK, anywhere), true, String(status))
  }
})

test('not found and gone say it does not', async () => {
  assert.equal(await pageExists(`${origin}/404`, LOOPBACK, anywhere), false)
  assert.equal(await pageExists(`${origin}/410`, LOOPBACK, anywhere), false)
})

test('HEAD is asked first and a redirect is not followed', async () => {
  await pageExists(`${origin}/302`, LOOPBACK, anywhere)

  assert.deepEqual(seen, ['HEAD /302'])
})

test('a server that refuses HEAD is asked with GET', async () => {
  assert.equal(await pageExists(`${origin}/no-head`, LOOPBACK, anywhere), true)
  assert.deepEqual(seen, ['HEAD /no-head', 'GET /no-head'])
})

test('no answer at all says it does not', async () => {
  assert.equal(await pageExists(`${origin}/hang`, LOOPBACK, anywhere), false)
  assert.equal(await pageExists('http://127.0.0.1:1/', LOOPBACK, anywhere), false)
})

test('by default nothing but a public address is reached', async () => {
  assert.equal(await pageExists(`${origin}/200`, LOOPBACK), false)
  assert.equal(await pageExists(`${origin.replace('127.0.0.1', 'localhost')}/200`, LOOPBACK), false)
  assert.equal(await pageExists(`${origin}/200`, '::ffff:7f00:1'), false)
  assert.deepEqual(seen, [])
})

// A literal host is connected to as written, so an address that disagrees with it is refused.
test('a literal host pinned to some other address is not requested', async () => {
  assert.equal(await pageExists(`${origin}/200`, '127.0.0.2', anywhere), false)
  assert.deepEqual(seen, [])
})

// Nothing resolves `.invalid`, so an answer at all says the vetted address was used as it stood,
// and a second resolution, which could answer differently, never happened.
test('the request goes to the vetted address and keeps the hostname', async () => {
  const port = new URL(origin).port
  const url = `http://pinned.invalid:${port}/no-head`

  assert.equal(await pageExists(url, LOOPBACK, anywhere), true)
  assert.deepEqual(seen, ['HEAD /no-head', 'GET /no-head'])
  assert.deepEqual(hosts, [`pinned.invalid:${port}`, `pinned.invalid:${port}`])
})

test('the pinned lookup answers with the vetted address whatever it is asked', async () => {
  const lookup = pinnedLookup('2606:2800:220:1::1')

  const single = await new Promise<unknown[]>((resolve) => {
    lookup('rebind.example', {}, (...answer: unknown[]) => resolve(answer))
  })
  const every = await new Promise<unknown[]>((resolve) => {
    lookup('rebind.example', { all: true }, (...answer: unknown[]) => resolve(answer))
  })

  assert.deepEqual(single, [null, '2606:2800:220:1::1', 6])
  assert.deepEqual(every, [null, [{ address: '2606:2800:220:1::1', family: 6 }]])
})
