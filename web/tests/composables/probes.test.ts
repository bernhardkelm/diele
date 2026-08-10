import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHealth, resetHealth } from '@/composables/useHealth'
import { useLocalhostStatus } from '@/composables/useLocalhostStatus'
import { withSetup } from '@tests/support/withSetup'
import type { SuggestionTarget } from '@/types/portal'

/**
 * Builds a saved site pointing wherever the test needs.
 * @param {string} ref - Stable identity
 * @param {string} url - Where it points
 * @returns {SuggestionTarget} - The site
 */
function site(ref: string, url: string): SuggestionTarget {
  return { ref, kind: 'suggestion', name: ref, url }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // The readings are shared at module scope, so one test's would otherwise be the next one's
  resetHealth()
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

describe('useHealth', () => {
  /**
   * Answers the health endpoint with the given readings.
   * @param {object} options - Payload and status to answer with
   * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
   */
  function stubHealth(options: { readings?: Record<string, unknown>; status?: number } = {}) {
    return vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            readings: options.readings ?? { 'card:1': { state: 'up' } },
            pollSeconds: 60,
          }),
          { status: options.status ?? 200 },
        ),
      ),
    )
  }

  it('reports how a bound entry answered', async () => {
    vi.stubGlobal('fetch', stubHealth({ readings: { 'card:1': { state: 'up', uptime: 0.99 } } }))

    const { result } = withSetup(() => useHealth())
    await vi.waitFor(() => expect(result.readingFor('card:1')).toBeDefined())

    expect(result.readingFor('card:1')).toEqual({ state: 'up', uptime: 0.99 })
  })

  it('leaves an unbound entry without a dot', async () => {
    vi.stubGlobal('fetch', stubHealth())

    const { result } = withSetup(() => useHealth())
    await vi.waitFor(() => expect(result.readingFor('card:1')).toBeDefined())

    expect(result.readingFor('card:2')).toBeUndefined()
  })

  // The API drops anything genuinely stale itself, so what is on screen is current or gone.
  it('keeps the last readings when a poll fails', async () => {
    const fetchMock = stubHealth()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = withSetup(() => useHealth())
    await vi.waitFor(() => expect(result.readingFor('card:1')).toBeDefined())

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1))

    expect(result.readingFor('card:1')).toEqual({ state: 'up' })
  })

  it('polls again when the tab comes back to the front', async () => {
    const fetchMock = stubHealth()
    vi.stubGlobal('fetch', fetchMock)

    withSetup(() => useHealth())
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1))
  })

  it('stops polling once the view is gone', async () => {
    const fetchMock = stubHealth()
    vi.stubGlobal('fetch', fetchMock)

    const { wrapper } = withSetup(() => useHealth())
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    wrapper.unmount()

    const before = fetchMock.mock.calls.length
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()

    expect(fetchMock.mock.calls.length).toBe(before)
  })
})
