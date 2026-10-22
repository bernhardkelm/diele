import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { clearLapse } from '@/composables/sessionLapse'
import { resetHistory } from '@/composables/useHistory'
import { HISTORY_DELIVERED_EVENT } from '@/composables/useHistoryDelivery'
import { useHistorySection } from '@/features/settings/useHistorySection'
import type {
  SettingsField,
  SettingsItem,
  SettingsPagedItems,
  SettingsSection,
} from '@/features/settings/settingsSections'
import { withSetup } from '@tests/support/withSetup'
import { stubHistoryApi, type HistoryServer } from '@tests/support/historyApi'
import type { ApiHistoryEntry, ApiHistoryState } from '@diele/common'

const STATE: ApiHistoryState = {
  available: true,
  sources: { diele: true, extension: false },
  enabled: true,
  excludedDomains: ['b.com'],
  kept: 1,
}

const PAGE: ApiHistoryEntry = {
  id: 1,
  url: 'https://github.com/example/diele',
  title: 'diele',
  visits: 3,
  lastVisitedAt: '2026-10-01T00:00:00Z',
}

/**
 * Mounts the section open, on top of a fake api, and waits for the state to arrive.
 * @param {Partial<HistoryServer>} server - What the api holds, the feature on by default
 * @returns {Promise<object>} - The section's source, the api and the open section's id
 */
async function mountOpen(server: Partial<HistoryServer> = {}) {
  const api = stubHistoryApi({ state: STATE, kept: [PAGE], ...server })
  const expanded = ref<string | undefined>('history')
  const { result } = withSetup(() => useHistorySection(() => expanded.value))

  await vi.waitFor(() => expect(api.calls('/api/history')).toBe(1))
  await flushPromises()

  return { ...result, api, expanded }
}

/**
 * Returns the kept pages of a section.
 * @param {SettingsSection | undefined} section - Section as built
 * @returns {SettingsPagedItems} - Its paged run
 */
function pagesOf(section: SettingsSection | undefined): SettingsPagedItems {
  return section!.rows!.find((row) => row.kind === 'paged') as SettingsPagedItems
}

afterEach(() => {
  resetHistory()
  clearLapse()
  vi.unstubAllGlobals()
})

describe('once the admin turns history off', () => {
  it('still lists what is kept, each page forgettable, and nothing to opt into or exclude', async () => {
    const { section, api } = await mountOpen({
      state: { ...STATE, available: false, kept: 1 },
    })

    await vi.waitFor(() => expect(pagesOf(section.value).items).toHaveLength(1))

    expect(section.value!.options).toEqual([])
    expect(section.value!.rows!.map((row) => `${row.kind}:${row.id}`)).toEqual([
      'action:clear-history',
      'paged:pages',
    ])
    expect(section.value!.description).toMatch(/no longer keeps history/)
    expect(api.calls('/api/history/entries')).toBe(1)

    await pagesOf(section.value).items[0]!.remove()

    expect(api.calls('/api/history/entries/1', 'DELETE')).toBe(1)
    expect(pagesOf(section.value).items).toEqual([])
    // still on screen while open, saying nothing is left, rather than vanishing under the caret
    expect(section.value!.rows![0]).toMatchObject({ description: 'nothing is kept for you' })
  })

  it('says nothing at all where nothing is kept either', async () => {
    const { section, api } = await mountOpen({
      state: { ...STATE, available: false, kept: 0 },
      kept: [],
    })

    expect(section.value).toBeUndefined()
    expect(api.calls('/api/history/entries')).toBe(0)
  })
})

describe('a delivery from the extension', () => {
  // The open list is what a delivery adds to, so it is read again rather than left for next time.
  it('reads the kept pages of the open section again', async () => {
    const { api } = await mountOpen({
      state: { ...STATE, sources: { diele: true, extension: true } },
    })
    await vi.waitFor(() => expect(api.calls('/api/history/entries')).toBe(1))
    vi.useFakeTimers()

    window.dispatchEvent(new Event(HISTORY_DELIVERED_EVENT))
    await vi.advanceTimersByTimeAsync(1000)
    vi.useRealTimers()

    await vi.waitFor(() => expect(api.calls('/api/history/entries')).toBe(2))
  })
})

describe('preference changes in quick succession', () => {
  // Excluding one domain and taking another off before the first answers must keep both changes.
  it('keeps an exclusion made while another change was on its way', async () => {
    const { section, api } = await mountOpen()
    const release = api.hold('PUT', '/api/history/preferences')

    const field = section.value!.rows!.find((row) => row.kind === 'field') as SettingsField
    const domain = section.value!.rows!.find(
      (row) => row.kind === 'item' && row.id === 'domain:b.com',
    ) as SettingsItem

    const excluding = field.submit('a.com')
    const including = domain.remove()
    await flushPromises()
    release()
    await Promise.all([excluding, including])

    expect(api.server.state.excludedDomains).toEqual(['a.com'])
  })
})

describe('a change that does not land', () => {
  it('says so for a refused delete, and clears it on the next change', async () => {
    const { section, error, api } = await mountOpen()
    await vi.waitFor(() => expect(pagesOf(section.value).items).toHaveLength(1))
    api.server.writeStatus = 500

    await pagesOf(section.value).items[0]!.remove()

    expect(error.value).toBe('the portal did not forget that page, try again')

    api.server.writeStatus = 200
    section.value!.options[0]!.run()
    await flushPromises()

    expect(error.value).toBeUndefined()
  })

  it('says so for a refused preference change', async () => {
    const { section, error, api } = await mountOpen()
    api.server.writeStatus = 500

    section.value!.options[0]!.run()
    await flushPromises()

    expect(error.value).toBe('the portal did not take the change, try again')
  })

  // The portal already says once that the session is gone, for every request at once.
  it('says nothing of its own for a lapsed session', async () => {
    const { section, error, api } = await mountOpen()
    await vi.waitFor(() => expect(pagesOf(section.value).items).toHaveLength(1))
    api.server.writeStatus = 401

    await pagesOf(section.value).items[0]!.remove()
    await section.value!.rows!.find((row) => row.kind === 'action')!.run()
    await flushPromises()

    expect(error.value).toBeUndefined()
  })
})

describe('a long history', () => {
  const many: ApiHistoryEntry[] = Array.from({ length: 250 }, (_, index) => ({
    ...PAGE,
    id: index + 1,
    url: `https://site${index + 1}.example/`,
    title: `page ${index + 1}`,
  }))

  it('lists the most recent hundred, and a hundred more each time it is asked', async () => {
    const { section } = await mountOpen({ state: { ...STATE, kept: 250 }, kept: many })
    await vi.waitFor(() => expect(pagesOf(section.value).items).toHaveLength(250))

    expect(pagesOf(section.value).shown).toBe(100)
    expect(pagesOf(section.value).more(150)).toMatchObject({ label: 'Show 100 more', trail: '150' })

    pagesOf(section.value).more(150).run()

    expect(pagesOf(section.value).shown).toBe(200)
  })

  it('lists the first hundred again once the section is closed and opened', async () => {
    const { section, expanded } = await mountOpen({ state: { ...STATE, kept: 250 }, kept: many })
    await vi.waitFor(() => expect(pagesOf(section.value).items).toHaveLength(250))

    pagesOf(section.value).more(150).run()
    expanded.value = undefined
    await flushPromises()
    expanded.value = 'history'
    await flushPromises()

    expect(pagesOf(section.value).shown).toBe(100)
  })
})
