import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { clearLapse, sessionLapsed } from '@/composables/sessionLapse'
import { refreshHistory, resetHistory, useHistory } from '@/composables/useHistory'
import { withSetup } from '@tests/support/withSetup'
import { stubHistoryApi } from '@tests/support/historyApi'
import type { ApiHistoryEntry, ApiHistoryState } from '@diele/common'

const STATE: ApiHistoryState = {
  available: true,
  sources: { diele: true, extension: false },
  enabled: true,
  excludedDomains: [],
  kept: 2,
}

const PAGE: ApiHistoryEntry = {
  id: 1,
  url: 'https://github.com/example/diele',
  title: 'diele',
  visits: 3,
  lastVisitedAt: '2026-10-01T00:00:00Z',
}

/**
 * Stubs an api with the feature on, one page in the search slice.
 * @param {Partial<ApiHistoryState>} state - What to vary about the state
 * @returns {ReturnType<typeof stubHistoryApi>} - The stub and its controls
 */
function stubApi(state: Partial<ApiHistoryState> = {}): ReturnType<typeof stubHistoryApi> {
  return stubHistoryApi({ state: { ...STATE, ...state }, entries: [PAGE], kept: [PAGE] })
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
    const api = stubApi()
    const showing = ref(false)
    const { result } = withSetup(() => useHistory(() => showing.value))

    await nextTick()
    expect(api.fetch).not.toHaveBeenCalled()

    showing.value = true
    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))
    expect(result.state.value).toEqual(STATE)
  })

  // Once per page load, however many views read it and however often they come back.
  it('reads once, not again for a second reader or a view coming back', async () => {
    const api = stubApi()
    const showing = ref(true)
    const { result } = withSetup(() => useHistory(() => showing.value))
    withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))

    showing.value = false
    await nextTick()
    showing.value = true
    await nextTick()

    expect(api.calls('/api/history')).toBe(1)
  })

  it('reports a lapsed session on a 401 and keeps the list empty', async () => {
    const api = stubApi()
    api.server.readStatus = 401
    const { result } = withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(sessionLapsed.value).toBe(true))
    expect(result.entries.value).toEqual([])
    expect(result.state.value.available).toBe(false)
  })

  // The api serves the state whatever the switches say, so a failure is all that leaves it unread.
  it('keeps the list empty on a failed read without reporting a lapse', async () => {
    const api = stubApi()
    api.server.readStatus = 500
    const { result } = withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(api.fetch).toHaveBeenCalled())
    await nextTick()

    expect(sessionLapsed.value).toBe(false)
    expect(result.entries.value).toEqual([])
  })

  it('takes the state an instance with history off serves, and how much is still kept', async () => {
    stubHistoryApi({ state: { ...STATE, available: false, enabled: false, kept: 7 } })
    const { result } = withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(result.state.value.kept).toBe(7))
    expect(result.state.value.available).toBe(false)
    expect(result.entries.value).toEqual([])
  })

  it('reads an older api that left fields out as off', async () => {
    stubHistoryApi({ state: { available: true } as ApiHistoryState, entries: [] })
    const { result } = withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(result.state.value.available).toBe(true))
    expect(result.state.value).toEqual({
      available: true,
      sources: { diele: false, extension: false },
      enabled: false,
      excludedDomains: [],
      kept: 0,
    })
    expect(result.entries.value).toEqual([])
  })

  // Where someone has been is not left in the browser for whoever opens it next.
  it('keeps nothing in storage', async () => {
    stubApi()
    const { result } = withSetup(() => useHistory(() => true))

    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('reads again on request only once something has asked for it', async () => {
    const api = stubApi()

    await refreshHistory()
    expect(api.fetch).not.toHaveBeenCalled()

    const { result } = withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))

    await refreshHistory()
    expect(api.calls('/api/history')).toBe(2)
  })
})

describe('resetHistory', () => {
  // The next account to sign in on this page must not be offered where the last one went.
  it('drops everything held, and the next reader reads again', async () => {
    const api = stubApi()
    const { result } = withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(result.entries.value).toEqual([PAGE]))

    resetHistory()

    expect(result.entries.value).toEqual([])
    expect(result.state.value.available).toBe(false)

    withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(api.calls('/api/history')).toBe(2))
  })

  // A local sign-in changes the account without a reload, so a read sent for the previous one
  // may still be on its way when the next one signs in.
  it('drops a read still on its way, so it cannot land for the next account', async () => {
    const api = stubApi()
    const release = api.hold('GET', '/api/history')
    const { result } = withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(api.calls('/api/history')).toBe(1))

    resetHistory()
    release()
    await flushPromises()

    expect(result.entries.value).toEqual([])
    expect(result.state.value.available).toBe(false)
  })
})
