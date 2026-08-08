import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalhostStatus } from '@/composables/useLocalhostStatus'
import { useServiceStatus } from '@/composables/useServiceStatus'
import { withSetup } from '@/testing/withSetup'
import type { CardTarget, SuggestionTarget } from '@/types/portal'

/**
 * Builds a saved site pointing wherever the test needs.
 * @param {string} ref - Stable identity
 * @param {string} url - Where it points
 * @returns {SuggestionTarget} - The site
 */
function site(ref: string, url: string): SuggestionTarget {
  return { ref, kind: 'suggestion', name: ref, url }
}

const card: CardTarget = {
  ref: 'card:1',
  kind: 'card',
  name: 'Grafana',
  url: 'https://grafana.example.com',
  icon: '',
  color: 'currentColor',
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useLocalhostStatus', () => {
  it('probes only the local entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    vi.stubGlobal('fetch', fetchMock)

    withSetup(() =>
      useLocalhostStatus(() => [
        site('port:1', 'http://localhost:5173'),
        site('site:1', 'https://example.com'),
      ]),
    )
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://localhost:5173')
  })

  // The response is opaque and unreadable, but a refused connection still rejects, and
  // reaching the port at all is the whole question.
  it('probes without asking the dev server to opt in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    vi.stubGlobal('fetch', fetchMock)

    withSetup(() => useLocalhostStatus(() => [site('port:1', 'http://localhost:5173')]))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ mode: 'no-cors', cache: 'no-store' })
  })

  it('reports a port that answered as live', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)))
    const local = site('port:1', 'http://localhost:5173')

    const { result } = withSetup(() => useLocalhostStatus(() => [local]))
    await vi.waitFor(() => expect(result.isLive(local)).toBe(true))
  })

  // A probe can fail because nothing is running, but equally because a browser refused the
  // request, so only the reachable ones are reported.
  it('reports a port that did not answer as simply not live', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')))
    const local = site('port:1', 'http://localhost:5173')

    const { result } = withSetup(() => useLocalhostStatus(() => [local]))
    await vi.waitFor(() => expect(result.isLive(local)).toBe(false))
  })

  it('probes nothing at all when no entry is local', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    withSetup(() => useLocalhostStatus(() => [site('site:1', 'https://example.com')]))
    await Promise.resolve()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Exactly when a dev server has just been started elsewhere.
  it('probes again when the tab comes back to the front', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    vi.stubGlobal('fetch', fetchMock)

    withSetup(() => useLocalhostStatus(() => [site('port:1', 'http://localhost:5173')]))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})

describe('useServiceStatus', () => {
  const summary = {
    publicGroupList: [
      { monitorList: [{ id: 1, name: 'Grafana', url: 'https://grafana.example.com' }] },
    ],
  }
  const heartbeats = { heartbeatList: { '1': [{ status: 1 }] }, uptimeList: { '1_24': 0.99 } }

  /**
   * Answers both status page endpoints.
   * @param {object} options - Status to answer with
   * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
   */
  function stubKuma(options: { status?: number } = {}) {
    return vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(JSON.stringify(String(input).includes('heartbeat') ? heartbeats : summary), {
          status: options.status ?? 200,
        }),
      ),
    )
  }

  it('resolves a card to what its monitor reports', async () => {
    vi.stubGlobal('fetch', stubKuma())

    const { result } = withSetup(() => useServiceStatus(() => [card]))
    await vi.waitFor(() => expect(result.statusFor(card)).toBeDefined())

    expect(result.statusFor(card)).toEqual({ state: 'up', uptime: 0.99 })
  })

  it('leaves an unmonitored card without a dot', async () => {
    vi.stubGlobal('fetch', stubKuma())
    const other: CardTarget = {
      ...card,
      ref: 'card:2',
      name: 'Other',
      url: 'https://other.example',
    }

    const { result } = withSetup(() => useServiceStatus(() => [card, other]))
    await vi.waitFor(() => expect(result.statusFor(card)).toBeDefined())

    expect(result.statusFor(other)).toBeUndefined()
  })

  // A portal that cannot reach Kuma shows no dots rather than a wall of red.
  it('drops every dot when the status page cannot be read', async () => {
    vi.stubGlobal('fetch', stubKuma({ status: 404 }))

    const { result } = withSetup(() => useServiceStatus(() => [card]))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())

    expect(result.statusFor(card)).toBeUndefined()
  })

  it('drops every dot when the request fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { result } = withSetup(() => useServiceStatus(() => [card]))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())

    expect(result.statusFor(card)).toBeUndefined()
  })

  it('polls again when the tab comes back to the front', async () => {
    const fetchMock = stubKuma()
    vi.stubGlobal('fetch', fetchMock)

    withSetup(() => useServiceStatus(() => [card]))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(2))
  })

  it('stops polling once the view is gone', async () => {
    const fetchMock = stubKuma()
    vi.stubGlobal('fetch', fetchMock)

    const { wrapper } = withSetup(() => useServiceStatus(() => [card]))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    wrapper.unmount()

    const before = fetchMock.mock.calls.length
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()

    expect(fetchMock.mock.calls.length).toBe(before)
  })
})
