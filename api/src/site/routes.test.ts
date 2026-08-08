import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import express, { type NextFunction, type Request, type Response } from 'express'
import { createSiteRouter } from './routes.js'

const HASHED_ASSET = 'index-abc123.js'
const INDEX_MARKER = '<title>diele</title>'

interface RunningSite {
  readonly url: string
  readonly close: () => Promise<void>
}

/**
 * Starts a throwaway app on the site router, followed by a stand-in for the routers the real app
 * mounts after it. Anything answering `{ handedBack: true }` reached those rather than the
 * directory.
 * @param {string} siteRoot - Directory the router serves
 * @returns {Promise<RunningSite>} - Where it listens, and how to stop it
 */
async function startSite(siteRoot: string): Promise<RunningSite> {
  const app = express()
  app.use(createSiteRouter(siteRoot))
  app.use((_req, res) => {
    res.status(404).json({ handedBack: true })
  })

  // The 4xx branch of the real handler in `app.ts`: serve-static reports a missing hashed file by
  // passing a 404 error on, and express would otherwise answer it with a stack trace.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as { status?: number }).status ?? 500
    res.status(status).json({ error: 'not found' })
  })

  const server: Server = app.listen(0)
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

let root: string
let site: RunningSite

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'diele-site-'))
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'index.html'), `<!doctype html>${INDEX_MARKER}`)
  writeFileSync(join(root, 'assets', HASHED_ASSET), 'export default 1\n')
  writeFileSync(join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" />')

  site = await startSite(root)
})

after(async () => {
  await site.close()
  rmSync(root, { recursive: true, force: true })
})

test('the root serves the document, and never from a cache', async () => {
  const response = await fetch(`${site.url}/`)

  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /text\/html/)
  assert.match(response.headers.get('cache-control') ?? '', /no-cache/)
  assert.match(await response.text(), new RegExp(INDEX_MARKER))
})

// The filename carries the content hash, so the url changes whenever the file does and the old
// one can be held for as long as the browser likes.
test('a hashed asset is served immutable for a year', async () => {
  const response = await fetch(`${site.url}/assets/${HASHED_ASSET}`)

  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control') ?? '', /max-age=31536000/)
  assert.match(response.headers.get('cache-control') ?? '', /immutable/)
})

test('an unhashed file revalidates rather than being frozen for a year', async () => {
  const response = await fetch(`${site.url}/favicon.svg`)

  assert.equal(response.status, 200)
  assert.doesNotMatch(response.headers.get('cache-control') ?? '', /immutable/)
})

// The failure this exists for: served the document instead, the browser would be told a javascript
// module is html and the app would die on a parse error naming the wrong file.
test('a hashed asset that is missing is a 404 rather than the document', async () => {
  const response = await fetch(`${site.url}/assets/gone-deadbeef.js`)

  assert.equal(response.status, 404)
  assert.doesNotMatch(await response.text(), new RegExp(INDEX_MARKER))
})

test('an unknown path opens the app, since the app routes on it', async () => {
  const response = await fetch(`${site.url}/admin/connectors`)

  assert.equal(response.status, 200)
  assert.match(await response.text(), new RegExp(INDEX_MARKER))
})

// The load-bearing one: the router sits ahead of every api route, so a path it answers is a path
// the api no longer owns.
test('the api keeps its own paths, including the ones nothing has claimed', async () => {
  for (const path of ['/api/config', '/api/nothing-here', '/api', '/status']) {
    const response = await fetch(`${site.url}${path}`)

    assert.equal(response.status, 404, path)
    assert.deepEqual(await response.json(), { handedBack: true }, path)
  }
})

// A document is what a browser asks for with GET; anything else reaching here is a caller talking
// to an endpoint that does not exist, and html is not an answer to that.
test('a write to an unknown path is handed back rather than answered with the document', async () => {
  const response = await fetch(`${site.url}/admin`, { method: 'POST' })

  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { handedBack: true })
})

test('a directory holding no build serves nothing at all', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'diele-site-empty-'))
  const unbuilt = await startSite(empty)

  try {
    const response = await fetch(`${unbuilt.url}/`)

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { handedBack: true })
  } finally {
    await unbuilt.close()
    rmSync(empty, { recursive: true, force: true })
  }
})
