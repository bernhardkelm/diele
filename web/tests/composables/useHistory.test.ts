import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { clearLapse, sessionLapsed } from '@/composables/sessionLapse'
import { refreshHistory, resetHistory, useHistory } from '@/composables/useHistory'
import { withSetup } from '@tests/support/withSetup'
import type { ApiHistory, ApiHistoryEntry, ApiHistoryState } from '@diele/common'

const STATE: ApiHistoryState = {
  available: true,
  sources: { diele: true, extension: false },
  enabled: true,
  excludedDomains: [],
}

const PAGE: ApiHistoryEntry = {
  id: 1,
  url: 'https://github.com/example/diele',
  title: 'diele',
  visits: 3,
  lastVisitedAt: '2026-10-01T00:00:00Z',
}

const OLDER: ApiHistoryEntry = { ...PAGE, id: 2, url: 'https://old.example/', title: undefined }

/**
 * Answers the history endpoints the way an api with the feature on would.
 * @param {object} options - Status the read answers with, and what it serves
 * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
 */
function stubApi({
  status = 200,
  history = { state: STATE, entries: [PAGE] },
  kept = [PAGE, OLDER],
  preferences = STATE,
}: {
  status?: number
  history?: Partial<ApiHistory>
  kept?: ReadonlyArray<ApiHistoryEntry>
  preferences?: ApiHistoryState
} = {}): ReturnType<typeof vi.fn> {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (status !== 200) {
      return Promise.resolve(new Response(JSON.stringify({}), { status }))
    }

    if (url === '/api/history') {
      return Promise.resolve(new Response(JSON.stringify(history)))
    }

    if (url === '/api/history/entries' && method === 'GET') {
      return Promise.resolve(new Response(JSON.stringify({ entries: kept })))
    }

    if (url === '/api/history/preferences') {
      return Promise.resolve(new Response(JSON.stringify(preferences)))
    }

    return Promise.resolve(new Response(null, { status: 204 }))
  })

  vi.stubGlobal('fetch', fetch)

  return fetch
}

/**
 * Returns how often an endpoint was asked, by method.
 * @param {ReturnType<typeof vi.fn>} fetch - The stubbed fetch
 * @param {string} url - Endpoint to count
 * @param {string} method - Method to count
 * @returns {number} - Calls matching both
 */
function calls(fetch: ReturnType<typeof vi.fn>, url: string, method = 'GET'): number {
  return fetch.mock.calls.filter(
    ([input, init]) =>
      String(input) === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  ).length
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  resetHistory()
  clearLapse()
  vi.unstubAllGlobals()
})

describe('reading', () => {
  it('reads nothing until a view says it is on screen', async () => {
    const fetch = stubApi()
    const showing = ref(false)
    const { result } = withSetup(() => useHistory(() => showing.value))

    await nextTick()
    expect(fetch).not.toHaveBeenCalled()

    showing.value = true
    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))
    expect(result.state.value).toEqual(STATE)
  })

  // Once per page load, however many views read it and however often they come back.
  it('reads once, not again for a second reader or a view coming back', async () => {
    const fetch = stubApi()
    const showing = ref(true)
    const { result } = withSetup(() => useHistory(() => showing.value))
    withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))

    showing.value = false
    await nextTick()
    showing.value = true
    await nextTick()

    expect(calls(fetch, '/api/history')).toBe(1)
  })

  it('reports a lapsed session on a 401 and keeps the list empty', async () => {
    stubApi({ status: 401 })
    const { result } = withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(sessionLapsed.value).toBe(true))
    expect(result.entries.value).toEqual([])
    expect(result.state.value.available).toBe(false)
  })

  // A 403 is the feature or the opt-in being off, which signing in again would not change.
  it('keeps the list empty on a 403 without reporting a lapse', async () => {
    const fetch = stubApi({ status: 403 })
    const { result } = withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    await nextTick()

    expect(sessionLapsed.value).toBe(false)
    expect(result.entries.value).toEqual([])
  })

  it('reads an older api that left fields out as off', async () => {
    stubApi({ history: { state: { available: true } as ApiHistoryState } })
    const { result } = withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(result.state.value.available).toBe(true))
    expect(result.state.value).toEqual({
      available: true,
      sources: { diele: false, extension: false },
      enabled: false,
      excludedDomains: [],
    })
    expect(result.entries.value).toEqual([])
  })

  // Where someone has been is not left in the browser for whoever opens it next.
  it('keeps nothing in storage', async () => {
    stubApi()
    const { result } = withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))
    await result.loadKept()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('reads again on request only once something has asked for it', async () => {
    const fetch = stubApi()

    await refreshHistory()
    expect(fetch).not.toHaveBeenCalled()

    const { result } = withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))

    await refreshHistory()
    expect(calls(fetch, '/api/history')).toBe(2)
  })
})

describe('the settings list', () => {
  it('reads every kept page, and says where the read stands', async () => {
    stubApi()
    const { result } = withSetup(() => useHistory())

    expect(result.keptStatus.value).toBe('unread')

    await result.loadKept()

    expect(result.kept.value).toEqual([PAGE, OLDER])
    expect(result.keptStatus.value).toBe('read')
  })

  it('says the read failed rather than that nothing is kept', async () => {
    stubApi({ status: 500 })
    const { result } = withSetup(() => useHistory())

    await result.loadKept()

    expect(result.keptStatus.value).toBe('failed')
  })
})

describe('writing', () => {
  it('forgets one page in both lists, and reads the search slice again', async () => {
    stubApi()
    const { result } = withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))
    await result.loadKept()

    const fetch = stubApi({ history: { state: STATE, entries: [] } })
    const done = await result.remove(1)

    expect(done).toBe(true)
    expect(calls(fetch, '/api/history/entries/1', 'DELETE')).toBe(1)
    expect(result.kept.value).toEqual([OLDER])
    expect(result.entries.value).toEqual([])
  })

  it('forgets every page at once', async () => {
    const fetch = stubApi()
    const { result } = withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))
    await result.loadKept()

    expect(await result.clear()).toBe(true)
    expect(calls(fetch, '/api/history/entries', 'DELETE')).toBe(1)
    expect(result.kept.value).toEqual([])
    expect(result.entries.value).toEqual([])
  })

  it('keeps both lists when the api refuses a delete', async () => {
    stubApi()
    const { result } = withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))
    await result.loadKept()

    stubApi({ status: 403 })

    expect(await result.remove(1)).toBe(false)
    expect(result.kept.value).toEqual([PAGE, OLDER])
  })

  // Excluding a domain deletes what was kept on it, which only the api knows the extent of.
  it('takes the new state and reads both lists again after a preference change', async () => {
    stubApi()
    const { result } = withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))
    await result.loadKept()

    const next = { ...STATE, excludedDomains: ['github.com'] }
    const fetch = stubApi({
      history: { state: next, entries: [] },
      kept: [OLDER],
      preferences: next,
    })

    expect(await result.setPreferences({ excludedDomains: ['github.com'] })).toBe(true)

    const put = fetch.mock.calls.find(([input]) => String(input) === '/api/history/preferences')
    const init = put?.[1] as RequestInit | undefined
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      excludedDomains: ['github.com'],
    })
    expect(result.state.value.excludedDomains).toEqual(['github.com'])
    expect(result.entries.value).toEqual([])
    expect(result.kept.value).toEqual([OLDER])
  })

  it('reports a lapsed session on a write as well', async () => {
    stubApi({ status: 401 })
    const { result } = withSetup(() => useHistory())

    expect(await result.setPreferences({ enabled: true })).toBe(false)
    expect(sessionLapsed.value).toBe(true)
  })
})

describe('resetHistory', () => {
  // The next account to sign in on this page must not be offered where the last one went.
  it('drops everything held, and the next reader reads again', async () => {
    const fetch = stubApi()
    const { result } = withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))
    await result.loadKept()

    resetHistory()

    expect(result.entries.value).toEqual([])
    expect(result.kept.value).toEqual([])
    expect(result.keptStatus.value).toBe('unread')
    expect(result.state.value.available).toBe(false)

    withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(calls(fetch, '/api/history')).toBe(2))
  })
})
