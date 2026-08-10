import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TestApi {
  /** Where the app is actually listening, which is not the origin it believes it is served on */
  readonly url: string
  /** The origin `requireSameOrigin` accepts, sent on every unsafe request unless overridden */
  readonly origin: string
  request(path: string, init?: RequestInit): Promise<Response>
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  /** Revalidates a cached response the way a browser does, and answers with the status alone */
  conditionalGet(path: string, etag: string): Promise<number>
  /** Signs in through the mode the app was started in, leaving the cookie in the jar */
  signIn(): Promise<void>
  /** Drops the session cookie without telling the server, so the next request is anonymous */
  forgetCookies(): void
  close(): Promise<void>
}

/**
 * Boots the app on an ephemeral port against a database of its own, and returns a client that
 * carries cookies between requests the way a browser does.
 *
 * The environment is written before the app is imported, because `config` reads it once at
 * module load. That also makes this callable exactly once per process: node's test runner gives
 * each file its own, so one `startApi` per test file is the arrangement, and a file needing a
 * different mode is a second file.
 * @param {Record<string, string>} env - Environment to run under, merged over the test defaults
 * @returns {Promise<TestApi>} - A listening app and a client for it
 */
export async function startApi(env: Record<string, string> = {}): Promise<TestApi> {
  const dbPath = join(tmpdir(), `diele-test-${process.pid}-${randomUUID()}.db`)

  const defaults: Record<string, string> = {
    DB_PATH: dbPath,
    PUBLIC_ORIGIN: 'http://portal.test',
    // Not derived from PUBLIC_ORIGIN here: an http origin would clear it anyway, and stating it
    // keeps a `Secure` cookie from being dropped by the client below without a word.
    SESSION_COOKIE_SECURE: 'false',
    TRUST_PROXY: '',
    DIELE_SEED_STOCK_CONFIG: 'false',
  }

  for (const [key, value] of Object.entries({ ...defaults, ...env })) {
    if (value === '') {
      delete process.env[key]
      continue
    }

    process.env[key] = value
  }

  // Imported after the environment is in place, never at the top of this file.
  const { createApp } = await import('#app.js')
  const { config } = await import('#config.js')

  // `config` reads the environment once, at module load. A static import anywhere in the test
  // file reaches it before this function runs, and the app then quietly shares whatever database
  // the last caller left behind instead of the one asked for here. Loud, because the symptom is
  // otherwise a test that only fails once another file is added next to it.
  if (config.dbPath !== dbPath) {
    throw new Error(
      `startApi could not take over the environment: config was already loaded, pointing at ` +
        `${config.dbPath}. Import app modules dynamically after startApi, not at the top of the ` +
        `test file.`,
    )
  }

  // Pointed at a directory that holds no build, so these tests see the api alone. Left to find
  // the real `web/dist`, every assertion about a path the api does not own would answer the
  // frontend on a machine that has built it and 404 on one that has not.
  const server: Server = createApp(join(tmpdir(), 'diele-test-no-web-build')).listen(0)
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  const { port } = server.address() as AddressInfo
  const url = `http://127.0.0.1:${port}`
  const jar = new Map<string, string>()

  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)

    if (!headers.has('origin')) {
      headers.set('origin', config.publicOrigin)
    }

    if (jar.size > 0 && !headers.has('cookie')) {
      headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
    }

    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }

    const response = await fetch(`${url}${path}`, { ...init, headers, redirect: 'manual' })

    for (const raw of response.headers.getSetCookie()) {
      const [pair = ''] = raw.split(';')
      const separator = pair.indexOf('=')
      const name = pair.slice(0, separator).trim()
      const value = pair.slice(separator + 1).trim()

      if (!name) {
        continue
      }

      // An expiry in the past is a deletion, which is how logout clears the jar.
      if (value.length === 0 || /expires=Thu, 01 Jan 1970/i.test(raw)) {
        jar.delete(name)
        continue
      }

      jar.set(name, value)
    }

    return response
  }

  return {
    url,
    origin: config.publicOrigin,

    request,

    async get<T>(path: string): Promise<T> {
      const response = await request(path)
      return (await response.json()) as T
    },

    async post<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
      const response = await request(path, {
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        ...init,
      })

      return (await response.json()) as T
    },

    // Not through fetch. The spec has it drop the cache mode as soon as a conditional header is
    // present, so it appends `Cache-Control: no-cache`, and a server that honours that correctly
    // answers 200 - which is the opposite of what a revalidation is meant to measure.
    conditionalGet(path: string, etag: string): Promise<number> {
      const headers: Record<string, string> = { 'if-none-match': etag }

      if (jar.size > 0) {
        headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
      }

      return new Promise<number>((resolve, reject) => {
        const outgoing = httpRequest(
          { host: '127.0.0.1', port, path, method: 'GET', headers },
          (incoming) => {
            incoming.resume()
            incoming.once('end', () => resolve(incoming.statusCode ?? 0))
          },
        )

        outgoing.once('error', reject)
        outgoing.end()
      })
    },

    async signIn(): Promise<void> {
      // The same navigation the browser makes. In dev mode it opens the session outright; in
      // local mode it only bounces back, so a local test posts credentials itself.
      await request('/api/auth/login')
    },

    forgetCookies(): void {
      jar.clear()
    },

    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()))

      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${dbPath}${suffix}`, { force: true })
      }
    },
  }
}
