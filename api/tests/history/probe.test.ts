import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, test } from 'node:test'
import { type AddressPolicy, guardedLookup, pageExists, publicOnly } from '#history/probe.js'

let server: Server
let origin: string

/** Every request the server saw, as method and path. */
let seen: string[] = []

/** Lets the test server's loopback address through, which the default policy refuses. */
const anywhere = (): boolean => true

before(async () => {
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`)
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
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// Existence, not liveness: a login wall in front of a real page is the ordinary case.
test('any answer but not found and gone says the page exists', async () => {
  for (const status of [200, 204, 302, 401, 403, 500, 503]) {
    assert.equal(await pageExists(`${origin}/${status}`, anywhere), true, String(status))
  }
})

test('not found and gone say it does not', async () => {
  assert.equal(await pageExists(`${origin}/404`, anywhere), false)
  assert.equal(await pageExists(`${origin}/410`, anywhere), false)
})

test('HEAD is asked first and a redirect is not followed', async () => {
  await pageExists(`${origin}/302`, anywhere)

  assert.deepEqual(seen, ['HEAD /302'])
})

test('a server that refuses HEAD is asked with GET', async () => {
  assert.equal(await pageExists(`${origin}/no-head`, anywhere), true)
  assert.deepEqual(seen, ['HEAD /no-head', 'GET /no-head'])
})

test('no answer at all says it does not', async () => {
  assert.equal(await pageExists(`${origin}/hang`, anywhere), false)
  assert.equal(await pageExists('http://127.0.0.1:1/', anywhere), false)
  assert.equal(await pageExists('http://does-not-resolve.invalid/', anywhere), false)
})

// The policy holds for a literal, which is never resolved, and for a name, checked as it connects.
test('by default nothing but a public address is reached, however it is spelled', async () => {
  assert.equal(await pageExists(`${origin}/200`), false)
  assert.equal(await pageExists(`${origin.replace('127.0.0.1', 'localhost')}/200`), false)
  assert.equal(await pageExists(`${origin.replace('127.0.0.1', '[::ffff:7f00:1]')}/200`), false)
  assert.deepEqual(seen, [])
})

/**
 * Runs the connect-time resolver the way a socket does.
 * @param {string} hostname - Name to resolve
 * @param {AddressPolicy} allow - Policy to resolve under
 * @param {boolean} all - Whether every address is asked for, as happy eyeballs does
 * @returns {Promise<unknown>} - What it called back with, or the error it refused with
 */
function resolveForSocket(hostname: string, allow: AddressPolicy, all: boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    guardedLookup(allow)(hostname, { all }, (error, address) => {
      if (error) {
        reject(error)
        return
      }

      resolve(address)
    })
  })
}

// The name check in front of it never sees a name that only resolves to loopback, so the
// refusal at connect time is what holds against rebinding and nip.io-style names.
test('the connect-time resolver refuses an address the policy does not allow', async () => {
  await assert.rejects(resolveForSocket('localhost', publicOnly, false), /address refused/)
  await assert.rejects(resolveForSocket('localhost', publicOnly, true), /address refused/)
  await assert.rejects(resolveForSocket('does-not-resolve.invalid', anywhere, false))

  const loopbackOnly: AddressPolicy = (address) => address === 'loopback'
  const single = await resolveForSocket('localhost', loopbackOnly, false)
  const every = await resolveForSocket('localhost', loopbackOnly, true)

  assert.equal(typeof single, 'string')
  assert.ok(Array.isArray(every) && every.length > 0)
})
