import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { clearLapse, sessionLapsed } from '@/composables/sessionLapse'
import { resetHistory, useHistory } from '@/composables/useHistory'
import { useHistorySettings } from '@/composables/useHistorySettings'
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

const OLDER: ApiHistoryEntry = { ...PAGE, id: 2, url: 'https://old.example/', title: undefined }

/**
 * Stubs an api with the feature on and two pages kept, one of them in the search slice.
 * @returns {ReturnType<typeof stubHistoryApi>} - The stub and its controls
 */
function stubApi(): ReturnType<typeof stubHistoryApi> {
  return stubHistoryApi({ state: STATE, entries: [PAGE], kept: [PAGE, OLDER] })
}

/**
 * Mounts the settings the way the section does, a reader of the search slice included, and waits
 * for both lists.
 * @returns {Promise<ReturnType<typeof useHistorySettings> & ReturnType<typeof useHistory>>} - Both
 */
async function settings(): Promise<
  ReturnType<typeof useHistorySettings> & ReturnType<typeof useHistory>
> {
  const { result: search } = withSetup(() => useHistory(() => true))
  const { result } = withSetup(() => useHistorySettings())

  await vi.waitFor(() => expect(search.entries.value).toEqual([PAGE]))
  await result.loadKept()

  return { ...search, ...result }
}

afterEach(() => {
  resetHistory()
  clearLapse()
  vi.unstubAllGlobals()
})

describe('the settings list', () => {
  it('reads every kept page, and says where the read stands', async () => {
    stubApi()
    const { result } = withSetup(() => useHistorySettings())

    expect(result.keptStatus.value).toBe('unread')

    await result.loadKept()

    expect(result.kept.value).toEqual([PAGE, OLDER])
    expect(result.keptStatus.value).toBe('read')
  })

  it('says the read failed rather than that nothing is kept', async () => {
    const api = stubApi()
    api.server.readStatus = 500
    const { result } = withSetup(() => useHistorySettings())

    await result.loadKept()

    expect(result.keptStatus.value).toBe('failed')
  })

  it('keeps nothing in storage', async () => {
    stubApi()
    await settings()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})

describe('writing', () => {
  it('forgets one page in both lists, and reads the search slice again', async () => {
    const api = stubApi()
    const history = await settings()

    expect(await history.remove(1)).toBe('done')
    expect(api.calls('/api/history/entries/1', 'DELETE')).toBe(1)
    expect(api.calls('/api/history')).toBe(2)
    expect(history.kept.value).toEqual([OLDER])
    expect(history.entries.value).toEqual([])
  })

  it('forgets every page at once', async () => {
    const api = stubApi()
    const history = await settings()

    expect(await history.clear()).toBe('done')
    expect(api.calls('/api/history/entries', 'DELETE')).toBe(1)
    expect(history.kept.value).toEqual([])
    expect(history.entries.value).toEqual([])
    expect(history.state.value.kept).toBe(0)
  })

  it('keeps both lists and says it failed when the api refuses a delete', async () => {
    const api = stubApi()
    const history = await settings()
    api.server.writeStatus = 403

    expect(await history.remove(1)).toBe('failed')
    expect(history.kept.value).toEqual([PAGE, OLDER])
    expect(sessionLapsed.value).toBe(false)
  })

  // Excluding a domain deletes what was kept on it, which only the api knows the extent of.
  it('takes the new state and reads both lists again after a preference change', async () => {
    const api = stubApi()
    const history = await settings()
    api.server.entries = []
    api.server.kept = [OLDER]

    const outcome = await history.setPreferences(() => ({ excludedDomains: ['github.com'] }))

    expect(outcome).toBe('done')
    expect(api.bodies('/api/history/preferences', 'PUT')).toEqual([
      { excludedDomains: ['github.com'] },
    ])
    expect(history.state.value.excludedDomains).toEqual(['github.com'])
    expect(history.entries.value).toEqual([])
    expect(history.kept.value).toEqual([OLDER])
  })

  it('reports a lapsed session on a write as well', async () => {
    const api = stubApi()
    api.server.writeStatus = 401
    const { result } = withSetup(() => useHistorySettings())

    expect(await result.setPreferences(() => ({ enabled: true }))).toBe('lapsed')
    expect(sessionLapsed.value).toBe(true)
  })

  // Two changes made before the first answers would otherwise each send a list without the other.
  it('builds each preference change from the state the one before it left', async () => {
    const api = stubHistoryApi({ state: { ...STATE, excludedDomains: ['b.com'] } })
    withSetup(() => useHistory(() => true))
    const { result } = withSetup(() => useHistorySettings())
    await vi.waitFor(() => expect(result.state.value.excludedDomains).toEqual(['b.com']))
    const release = api.hold('PUT', '/api/history/preferences')

    const first = result.setPreferences((current) => ({
      excludedDomains: [...current.excludedDomains, 'a.com'],
    }))
    const second = result.setPreferences((current) => ({
      excludedDomains: current.excludedDomains.filter((domain) => domain !== 'b.com'),
    }))

    await flushPromises()
    expect(api.calls('/api/history/preferences', 'PUT')).toBe(1)

    release()
    expect(await Promise.all([first, second])).toEqual(['done', 'done'])

    expect(api.bodies('/api/history/preferences', 'PUT')).toEqual([
      { excludedDomains: ['b.com', 'a.com'] },
      { excludedDomains: ['a.com'] },
    ])
    expect(api.server.state.excludedDomains).toEqual(['a.com'])
    expect(result.state.value.excludedDomains).toEqual(['a.com'])
  })
})

describe('answers outdated by a write', () => {
  // The read was served before the delete, so it still carries the page just forgotten.
  it('drops a kept read sent before a delete, and reads the list again', async () => {
    const api = stubApi()
    const history = await settings()
    const release = api.hold('GET', '/api/history/entries')

    const reading = history.loadKept()
    await history.remove(1)
    release()
    await reading
    await flushPromises()

    expect(history.kept.value).toEqual([OLDER])
    expect(api.calls('/api/history/entries')).toBe(3)
  })

  it('reads the search slice afresh after a delete rather than joining a read from before it', async () => {
    const api = stubHistoryApi({ state: STATE, entries: [PAGE], kept: [PAGE, OLDER] })
    const release = api.hold('GET', '/api/history')
    const { result: search } = withSetup(() => useHistory(() => true))
    const { result } = withSetup(() => useHistorySettings())
    await vi.waitFor(() => expect(api.calls('/api/history')).toBe(1))

    await result.remove(1)
    release()
    await flushPromises()

    expect(api.calls('/api/history')).toBe(2)
    expect(search.entries.value).toEqual([])
  })

  it('drops a kept read still on its way when the account signs out', async () => {
    const api = stubApi()
    const release = api.hold('GET', '/api/history/entries')
    const { result } = withSetup(() => useHistorySettings())

    const reading = result.loadKept()
    resetHistory()
    release()
    await reading

    expect(result.kept.value).toEqual([])
    expect(result.keptStatus.value).toBe('unread')
  })
})
