import { vi } from 'vitest'
import type { ApiHistoryEntry, ApiHistoryState } from '@diele/common'

/** What the fake api holds, which its writes change the way the real one's would */
export interface HistoryServer {
  state: ApiHistoryState
  /** The search slice */
  entries: ApiHistoryEntry[]
  /** Every kept page */
  kept: ApiHistoryEntry[]
  /** Status every read answers with, 200 for a working api */
  readStatus: number
  /** Status every write answers with, 200 for one that takes it */
  writeStatus: number
}

export interface HistoryApi {
  readonly fetch: ReturnType<typeof vi.fn>
  readonly server: HistoryServer
  /**
   * Holds the next request to one endpoint, answering it as the server stood when it was sent,
   * only once the returned release is called
   */
  hold: (method: string, url: string) => () => void
  /** Returns how often an endpoint was asked, by method */
  calls: (url: string, method?: string) => number
  /** Returns the bodies sent to an endpoint, in order */
  bodies: (url: string, method: string) => ReadonlyArray<unknown>
}

/**
 * Builds a json response.
 * @param {unknown} body - What to serve
 * @param {number} status - Status to answer with
 * @returns {Response} - The response
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/**
 * Answers one request against the fake server, applying a write to it.
 * @param {HistoryServer} server - What the api holds
 * @param {string} url - Endpoint asked
 * @param {string} method - Method used
 * @param {unknown} body - Parsed body, for a write
 * @returns {Response} - The answer
 */
function respond(server: HistoryServer, url: string, method: string, body: unknown): Response {
  if (method === 'GET') {
    if (server.readStatus !== 200) {
      return json({}, server.readStatus)
    }

    return url === '/api/history'
      ? json({ state: server.state, entries: server.entries })
      : json({ entries: server.kept })
  }

  if (server.writeStatus !== 200) {
    return json({}, server.writeStatus)
  }

  if (url === '/api/history/preferences') {
    server.state = { ...server.state, ...(body as Partial<ApiHistoryState>) }
    return json(server.state)
  }

  if (url === '/api/history/entries') {
    server.kept = []
    server.entries = []
  } else if (url.startsWith('/api/history/entries/')) {
    const id = Number(url.split('/').at(-1))
    server.kept = server.kept.filter((entry) => entry.id !== id)
    server.entries = server.entries.filter((entry) => entry.id !== id)
  }

  server.state = { ...server.state, kept: server.kept.length }

  return new Response(null, { status: 204 })
}

/**
 * Stubs fetch with a small history api that keeps what it is told, so a test can hold one request
 * back and see what an answer from before a write does once it lands.
 * @param {Partial<HistoryServer>} initial - What the api holds to begin with
 * @returns {HistoryApi} - The stub and its controls
 */
export function stubHistoryApi(
  initial: Partial<HistoryServer> & { state: ApiHistoryState },
): HistoryApi {
  const server: HistoryServer = {
    entries: [],
    kept: [],
    readStatus: 200,
    writeStatus: 200,
    ...initial,
  }
  const holds: Array<{ key: string; gate: Promise<void> }> = []

  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const answer = respond(
      server,
      url,
      method,
      init?.body ? JSON.parse(String(init.body)) : undefined,
    )
    const index = holds.findIndex((entry) => entry.key === `${method} ${url}`)

    if (index === -1) {
      return Promise.resolve(answer)
    }

    const [held] = holds.splice(index, 1)

    return held!.gate.then(() => answer)
  })

  vi.stubGlobal('fetch', fetch)

  return {
    fetch,
    server,
    hold: (method, url) => {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      holds.push({ key: `${method} ${url}`, gate })

      return () => release()
    },
    calls: (url, method = 'GET') =>
      fetch.mock.calls.filter(
        ([input, init]) =>
          String(input) === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
      ).length,
    bodies: (url, method) =>
      fetch.mock.calls
        .filter(
          ([input, init]) =>
            String(input) === url && (init as RequestInit | undefined)?.method === method,
        )
        .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as unknown),
  }
}
