import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'
import { createApp } from '#app.js'
import { getDb } from '#db/index.js'
import { createLink } from '#links/repository.js'
import { createLocalhost } from '#localhost/repository.js'
import { setEnabled } from '#settings/toggles.js'

const LOOPBACK_SOURCES = [
  'http://localhost:*',
  'https://localhost:*',
  'http://127.0.0.1:*',
  'https://127.0.0.1:*',
]

let root: string
let server: Server
let url: string

/**
 * Fetches the document the way a browser opening the portal does.
 * @param {string} path - Path to open
 * @returns {Promise<Response>} - The response, body unread
 */
function open(path = '/'): Promise<Response> {
  return fetch(`${url}${path}`)
}

/**
 * Reads the sources one directive of the document's policy allows.
 * @param {string} directive - Directive name
 * @returns {Promise<string[]>} - Its sources, in header order
 */
async function sourcesOf(directive: string): Promise<string[]> {
  const policy = (await open()).headers.get('content-security-policy') ?? ''
  const entry = policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive)
  assert.ok(entry, `no ${directive} in ${policy}`)

  return entry.slice(1)
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'diele-document-'))
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>diele</title><script>1</script>')
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'export default 1\n')

  server = createApp(root).listen(0)
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(root, { recursive: true, force: true })
})

// The shipped defaults: local ports off, saved sites on, and nothing on this machine saved.
beforeEach(() => {
  const db = getDb()
  db.prepare('DELETE FROM links').run()
  db.prepare('DELETE FROM localhost_ports').run()
  setEnabled('localhost', false)
  setEnabled('sites', true)
})

// `script-src 'self'` holds only while no same-origin response can be run as a script on a type
// the browser guessed, the document included.
test('every response, the document included, forbids sniffing its type', async () => {
  for (const path of ['/', '/admin', '/assets/index-abc123.js', '/status', '/api/config']) {
    const response = await open(path)

    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path)
  }
})

// A link out of the portal tells the site it leads to nothing about which instance it came from.
test('every response, the document included, sends no referrer to another origin', async () => {
  for (const path of ['/', '/admin', '/assets/index-abc123.js', '/status', '/api/config']) {
    const response = await open(path)

    assert.equal(response.headers.get('referrer-policy'), 'same-origin', path)
  }
})

test('the document keeps its own policy rather than the one every other response carries', async () => {
  const document = (await open()).headers.get('content-security-policy') ?? ''
  const asset = (await open('/assets/index-abc123.js')).headers.get('content-security-policy')

  assert.match(document, /script-src 'self' 'sha256-/)
  assert.equal(asset, "default-src 'none'; frame-ancestors 'none'")
})

test('with local ports off and nothing local saved, the page may not reach loopback', async () => {
  createLocalhost({ scheme: 'http', port: 5173, keywords: [] })
  createLink({ kind: 'site', label: 'Docs', url: 'https://docs.example.com', keywords: [] })

  assert.deepEqual(await sourcesOf('connect-src'), ["'self'"])
})

test('switching local ports on with a port saved lets the probe through', async () => {
  createLocalhost({ scheme: 'http', port: 5173, keywords: [] })
  setEnabled('localhost', true)

  assert.deepEqual(await sourcesOf('connect-src'), ["'self'", ...LOOPBACK_SOURCES])
})

test('switching local ports off again takes the loopback sources away on the next load', async () => {
  createLocalhost({ scheme: 'http', port: 5173, keywords: [] })
  setEnabled('localhost', true)
  assert.deepEqual(await sourcesOf('connect-src'), ["'self'", ...LOOPBACK_SOURCES])

  setEnabled('localhost', false)
  assert.deepEqual(await sourcesOf('connect-src'), ["'self'"])
})

test('local ports switched on with no port saved probe nothing, so allow nothing', async () => {
  setEnabled('localhost', true)

  assert.deepEqual(await sourcesOf('connect-src'), ["'self'"])
})

// The frontend probes every saved site on loopback, not only the local ports, so one of those
// needs the sources with the feature off.
test('a saved site on loopback is probed, and allowed, with local ports off', async () => {
  createLink({ kind: 'site', label: 'Grafana', url: 'http://127.0.0.1:3001/d/home', keywords: [] })

  assert.deepEqual(await sourcesOf('connect-src'), ["'self'", ...LOOPBACK_SOURCES])

  setEnabled('sites', false)
  assert.deepEqual(await sourcesOf('connect-src'), ["'self'"])
})
