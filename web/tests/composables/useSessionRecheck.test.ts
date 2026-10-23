import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSession } from '@/composables/useSession'
import { sessionLapsed } from '@/composables/sessionLapse'
import { useSessionRecheck } from '@/composables/useSessionRecheck'
import { withSetup } from '@tests/support/withSetup'

/**
 * Sets what `document.hidden` answers and announces the change, since jsdom leaves it false.
 * @param {boolean} hidden - Whether the tab is now in the background
 * @returns {void}
 */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

/**
 * Answers /me with a lapsed session, which is what a re-check is there to find.
 * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
 */
function stubLapsed() {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: 'authentication required' }), { status: 401 }),
    ),
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  resetSession()
})

afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  resetSession()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSessionRecheck', () => {
  // Coming back to a tab fires both, and the pair is one question about one session.
  it('reads the session once when visibility and focus arrive together', async () => {
    const fetchMock = stubLapsed()
    vi.stubGlobal('fetch', fetchMock)
    withSetup(() => useSessionRecheck())

    setHidden(false)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/auth/me')
    expect(sessionLapsed.value).toBe(true)
  })

  it('reads it again on a later return', async () => {
    const fetchMock = stubLapsed()
    vi.stubGlobal('fetch', fetchMock)
    withSetup(() => useSessionRecheck())

    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(60_000)
    setHidden(true)
    setHidden(false)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // Going behind is not looking at it, so it asks nothing.
  it('asks nothing when the tab goes behind', async () => {
    const fetchMock = stubLapsed()
    vi.stubGlobal('fetch', fetchMock)
    withSetup(() => useSessionRecheck())

    setHidden(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops listening with the component', async () => {
    const fetchMock = stubLapsed()
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = withSetup(() => useSessionRecheck())

    wrapper.unmount()
    window.dispatchEvent(new Event('focus'))
    setHidden(false)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
