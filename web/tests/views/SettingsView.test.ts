import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { ApiHidden, ApiHistoryEntry, ApiHistoryState } from '@diele/common'
import SettingsView from '@/views/SettingsView.vue'
import SettingsSectionRow from '@/features/settings/SettingsSectionRow.vue'
import SettingsItemRow from '@/features/settings/SettingsItemRow.vue'
import SettingsOptionRow from '@/features/settings/SettingsOptionRow.vue'
import ActionRow from '@/components/ActionRow.vue'
import { resetPortalConfig } from '@/composables/usePortalConfig'
import { resetConnectorEntries } from '@/composables/useConnectorEntries'
import { resetHistory } from '@/composables/useHistory'
import { useTheme } from '@/composables/useTheme'

const entries = {
  entries: [
    {
      ref: 'gitlab:1:1',
      connectorId: 1,
      connectorType: 'gitlab',
      kind: 'row',
      label: 'web',
      detail: 'example-group',
      url: 'https://gitlab.example/example-group/web',
      keywords: [],
      actions: [],
      timestamp: null,
      parentRef: null,
      searchOnly: false,
    },
  ],
  sources: [{ connectorId: 1, type: 'gitlab', label: 'work', syncedAt: null, error: null }],
  hidden: { all: [], mine: [] },
}

/**
 * Answers each endpoint the view reads, so it renders what a configured portal would.
 * @param {object} options - Whether the account may change what everyone sees, and what is hidden
 * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
 */
function stubApi({
  canAdmin = true,
  hidden = { all: [], mine: [] },
}: { canAdmin?: boolean; hidden?: ApiHidden } = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input)

    if (url.includes('/api/entries')) {
      return Promise.resolve(new Response(JSON.stringify({ ...entries, hidden })))
    }

    if (url.includes('/api/auth/me')) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: 1, name: 'Ada', email: null, picture: null, canAdmin })),
      )
    }

    return Promise.resolve(new Response(JSON.stringify({}), { status: 401 }))
  })
}

/**
 * Mounts the view and waits for the sections to arrive.
 * @returns {Promise<VueWrapper>} - The mounted view
 */
async function open(): Promise<VueWrapper> {
  const wrapper = mount(SettingsView, { attachTo: document.body })
  await vi.waitFor(() =>
    expect(wrapper.findAllComponents(SettingsSectionRow).length).toBeGreaterThan(0),
  )

  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
  resetPortalConfig()
  resetConnectorEntries()
  vi.stubGlobal('fetch', stubApi())
})

afterEach(() => {
  resetPortalConfig()
  resetConnectorEntries()
  useTheme().set('system')
  localStorage.clear()
  window.location.hash = ''
  document.documentElement.removeAttribute('data-theme')
  vi.unstubAllGlobals()
})

describe('what the list offers', () => {
  it('always offers the appearance section', async () => {
    const wrapper = await open()

    expect(wrapper.text()).toContain('Appearance')
  })

  // Offered whenever a connector is configured, whether or not it has produced anything: a
  // failing connector still has rows someone hid, and hiding the switch would strand them.
  it('offers the hidden-entry sections once a connector exists', async () => {
    const wrapper = await open()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Hidden entries'))

    expect(wrapper.text()).toContain('Hidden entries')
  })

  // A row an admin took off every list is out of this one whatever the account decides, so a
  // personal switch beside it would be a second control over the same row.
  it('leaves a row the portal hides from everyone out of the personal switches', async () => {
    vi.stubGlobal('fetch', stubApi({ hidden: { all: ['gitlab:1:1'], mine: [] } }))
    const wrapper = await open()

    const section = await vi.waitFor(() => {
      const row = wrapper
        .findAllComponents(SettingsSectionRow)
        .find((candidate) => candidate.props('section').id === 'hidden')
      expect(row).toBeDefined()

      return row!.props('section')
    })

    expect(section.options).toEqual([])
    expect(section.trail).toBe('0/0')
  })

  // The API refuses that scope independently; this only keeps the switch off a page where
  // every press would come back rejected.
  it('keeps the everyone scope off a page for an account that may not change it', async () => {
    vi.stubGlobal('fetch', stubApi({ canAdmin: false }))
    const wrapper = await open()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Hidden entries'))

    expect(wrapper.text()).not.toContain('Hidden for everyone')
  })

  // On every view rather than the portal alone: whoever is looking at a settings page is at
  // least as likely to be the one wondering how it works.
  it('carries the docs link the portal carries', async () => {
    const wrapper = await open()

    expect(wrapper.find('.page-footer a').attributes('href')).toBe(
      'https://github.com/bernhardkelm/diele',
    )
  })

  it('closes the list with a way back and a way out', async () => {
    const wrapper = await open()
    const actions = wrapper.findAllComponents(ActionRow).map((row) => row.props('action').id)

    expect(actions).toContain('leave')
    expect(actions).toContain('signout')
    expect(actions).toContain('signout-all')
  })
})

describe('opening a section', () => {
  // The route owns which section is open, so opening one survives a step back.
  it('puts the open section in the address', async () => {
    const wrapper = await open()

    await wrapper.findComponent(SettingsSectionRow).trigger('click')
    await nextTick()

    expect(window.location.hash).toBe('#/settings/appearance')
  })

  it('renders the section rows once it is open', async () => {
    const wrapper = await open()

    await wrapper.findComponent(SettingsSectionRow).trigger('click')
    await nextTick()

    const options = wrapper
      .findAllComponents(SettingsOptionRow)
      .map((row) => row.props('option').id)
    expect(options).toEqual(['theme'])
  })

  it('names the theme in force on its one row', async () => {
    const wrapper = await open()
    await wrapper.findComponent(SettingsSectionRow).trigger('click')
    await nextTick()

    expect(wrapper.findComponent(SettingsOptionRow).props('option').value).toBe('device')
  })

  it('steps to the next theme each time the row is run', async () => {
    const wrapper = await open()
    await wrapper.findComponent(SettingsSectionRow).trigger('click')
    await nextTick()

    wrapper.findComponent(SettingsOptionRow).props('option').run()
    await nextTick()

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    wrapper.findComponent(SettingsOptionRow).props('option').run()
    await nextTick()

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

// A reload opens on the list, not back inside whatever was open last time.
it('opens on the bare list even when the address names a section', async () => {
  window.location.hash = '/settings/appearance'
  const wrapper = await open()

  expect(wrapper.findAllComponents(SettingsOptionRow)).toHaveLength(0)
  expect(window.location.hash).toBe('#/settings')
})

describe('searching the list', () => {
  it('narrows to the sections a term addresses', async () => {
    const wrapper = await open()

    await wrapper.find('input').setValue('appearance')
    await nextTick()

    const labels = wrapper
      .findAllComponents(SettingsSectionRow)
      .map((row) => row.props('section').label)
    expect(labels).toEqual(['Appearance'])
  })

  it('offers nothing for a term that addresses none of them', async () => {
    const wrapper = await open()

    await wrapper.find('input').setValue('zzznothing')
    await nextTick()

    expect(wrapper.findAllComponents(SettingsSectionRow)).toHaveLength(0)
  })
})

// One pair of arrow keys reaches everything: a section's options are stations in the same
// list as the section itself.
describe('walking the list by keyboard', () => {
  /**
   * Sends a key press to the view, which owns one handler for the whole list.
   * @param {VueWrapper} wrapper - The mounted view
   * @param {string} key - Key name
   * @param {KeyboardEventInit} init - Modifiers
   * @returns {Promise<void>}
   */
  async function press(
    wrapper: VueWrapper,
    key: string,
    init: KeyboardEventInit = {},
  ): Promise<void> {
    // Sent to the focused row once the arrows have landed on one, because a row only answers a
    // key it owns; before that there is nothing focused inside the list, so the container takes
    // it the way a real key press would.
    const container = wrapper.find('.settings').element
    const focused = document.activeElement as HTMLElement | null
    const target = focused && container.contains(focused) ? focused : container

    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
    await nextTick()
  }

  it('steps onto the first row and down through the list', async () => {
    const wrapper = await open()

    await press(wrapper, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-station')).toBe('section:appearance')

    await press(wrapper, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-station')).not.toBe('section:appearance')
  })

  it('steps back up again', async () => {
    const wrapper = await open()

    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'ArrowUp')

    expect(document.activeElement?.getAttribute('data-station')).toBe('section:appearance')
  })

  // Tab moves the same way the arrows do, so there is one order rather than two.
  it('walks with tab as well as with the arrows', async () => {
    const wrapper = await open()

    await press(wrapper, 'Tab')
    expect(document.activeElement?.getAttribute('data-station')).toBe('section:appearance')
  })

  it('opens a section with enter and closes it again', async () => {
    const wrapper = await open()

    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'Enter')
    await vi.waitFor(() => expect(window.location.hash).toBe('#/settings/appearance'))

    await press(wrapper, 'Enter')
    await vi.waitFor(() => expect(window.location.hash).toBe('#/settings'))
  })

  it('leaves the list on escape', async () => {
    const wrapper = await open()

    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'Escape')

    expect(document.activeElement?.getAttribute('data-station')).toBeNull()
  })

  // The index is what a step is measured from, and the caret going back to the field by any
  // route leaves the list behind: a step from there starts at the top rather than one past the
  // row the arrows were last on, which here is the row that ends the session.
  it('starts at the top of the list once the caret is back in the field', async () => {
    const wrapper = await open()

    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'ArrowDown')

    wrapper.find<HTMLInputElement>('.launcher__input').element.focus()
    await nextTick()

    await press(wrapper, 'ArrowDown')

    expect(document.activeElement?.getAttribute('data-station')).toBe('section:appearance')
  })
})

describe('the history section', () => {
  const STATE: ApiHistoryState = {
    available: true,
    sources: { diele: true, extension: false },
    enabled: true,
    excludedDomains: ['bank.example'],
    kept: 1,
  }

  const PAGE: ApiHistoryEntry = {
    id: 1,
    url: 'https://github.com/example/diele',
    title: 'diele',
    visits: 3,
    lastVisitedAt: '2026-10-01T00:00:00Z',
  }

  const writes: Array<{ url: string; method: string; body?: unknown }> = []

  /**
   * Answers the history endpoints on top of the rest of the view's, recording every call.
   * @param {ApiHistoryState | undefined} state - What the instance and the account allow, or undefined for an api that refuses the read
   * @param {object} options - What is kept, and the status a write answers with
   * @returns {void}
   */
  function stubHistory(
    state: ApiHistoryState | undefined = STATE,
    { kept = [PAGE], writeStatus = 204 }: { kept?: ApiHistoryEntry[]; writeStatus?: number } = {},
  ): void {
    const api = stubApi()

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'

        if (!url.startsWith('/api/history')) {
          return api(input)
        }

        writes.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })

        if (!state) {
          return Promise.resolve(new Response(JSON.stringify({}), { status: 403 }))
        }

        if (url === '/api/history') {
          return Promise.resolve(new Response(JSON.stringify({ state, entries: [PAGE] })))
        }

        if (url === '/api/history/entries' && method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify({ entries: kept })))
        }

        if (writeStatus !== 204) {
          return Promise.resolve(new Response(JSON.stringify({}), { status: writeStatus }))
        }

        if (method === 'DELETE') {
          const id = Number(url.split('/').at(-1))
          kept = url === '/api/history/entries' ? [] : kept.filter((entry) => entry.id !== id)
        }

        if (url === '/api/history/preferences') {
          const next = { ...state, ...(init?.body ? JSON.parse(String(init.body)) : {}) }
          return Promise.resolve(new Response(JSON.stringify(next)))
        }

        return Promise.resolve(new Response(null, { status: 204 }))
      }),
    )
  }

  /**
   * Opens the history section, mounting the view first unless one is given, and waits for its
   * kept pages.
   * @param {VueWrapper} [mounted] - A view already on screen
   * @param {number} [rows] - Item rows to wait for, the excluded domain and one page by default
   * @returns {Promise<VueWrapper>} - The mounted view
   */
  async function openHistory(mounted?: VueWrapper, rows = 2): Promise<VueWrapper> {
    const wrapper = mounted ?? (await open())
    const row = await vi.waitFor(() => {
      const found = wrapper
        .findAllComponents(SettingsSectionRow)
        .find((candidate) => candidate.props('section').id === 'history')
      expect(found).toBeDefined()

      return found!
    })

    await row.trigger('click')
    await vi.waitFor(() => expect(wrapper.findAllComponents(SettingsItemRow)).toHaveLength(rows))

    return wrapper
  }

  /**
   * Puts the caret on one station and sends it a key, the way a press on the focused row would.
   * @param {VueWrapper} wrapper - The mounted view
   * @param {string} key - Key name
   * @returns {Promise<void>}
   */
  async function press(wrapper: VueWrapper, key: string): Promise<void> {
    const focused = document.activeElement as HTMLElement | null
    const target = focused ?? wrapper.find('.settings').element

    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await nextTick()
  }

  /**
   * Focuses the row standing for one station.
   * @param {VueWrapper} wrapper - The mounted view
   * @param {string} station - Its station key
   * @returns {Promise<void>}
   */
  async function focus(wrapper: VueWrapper, station: string): Promise<void> {
    wrapper.find<HTMLElement>(`[data-station="${station}"]`).element.focus()
    await nextTick()
  }

  beforeEach(() => {
    writes.length = 0
    resetHistory()
  })

  afterEach(() => {
    resetHistory()
  })

  // Not a disabled row, not a hint: an instance that does not offer it says nothing about it.
  it('says nothing about history where the instance does not offer it and keeps nothing', async () => {
    stubHistory({ ...STATE, available: false, kept: 0 }, { kept: [] })
    const wrapper = await open()
    await vi.waitFor(() => expect(writes.some((call) => call.url === '/api/history')).toBe(true))
    await nextTick()

    expect(wrapper.text()).not.toMatch(/history/i)
  })

  it('says nothing about it either where the api refuses the read', async () => {
    stubHistory(undefined)
    const wrapper = await open()
    await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0))
    await nextTick()

    expect(wrapper.text()).not.toMatch(/history/i)
  })

  it('reads the kept pages only once the section is opened', async () => {
    stubHistory()
    const wrapper = await open()
    await vi.waitFor(() => expect(wrapper.text()).toContain('History'))

    expect(writes.some((call) => call.url === '/api/history/entries')).toBe(false)

    await openHistory(wrapper)

    expect(writes.filter((call) => call.url === '/api/history/entries')).toHaveLength(1)
  })

  // One pair of arrow keys reaches every new row, in the order they are listed.
  it('walks the opt-in, the field, the domains, the clearing row and the pages', async () => {
    stubHistory()
    const wrapper = await openHistory()
    await focus(wrapper, 'section:history')

    const visited: Array<string | null> = []
    for (let step = 0; step < 5; step += 1) {
      await press(wrapper, 'ArrowDown')
      visited.push(document.activeElement?.getAttribute('data-station') ?? null)
    }

    expect(visited).toEqual([
      'option:history:enabled',
      'field:history:exclude',
      'item:history:domain:bank.example',
      'action:history:clear-history',
      'item:history:page:1',
    ])
  })

  it('shows what is still kept while the account is opted out', async () => {
    stubHistory({ ...STATE, enabled: false })
    const wrapper = await openHistory()

    expect(wrapper.text()).toContain('diele')
    expect(wrapper.text()).toContain('still kept from before')
  })

  it('opts in or out from the switch, keeping what is kept', async () => {
    stubHistory()
    const wrapper = await openHistory()

    await focus(wrapper, 'option:history:enabled')
    await press(wrapper, 'Enter')

    await vi.waitFor(() =>
      expect(writes.find((call) => call.method === 'PUT')?.body).toEqual({ enabled: false }),
    )
    expect(writes.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('excludes a domain typed into the field, pasted address and all', async () => {
    stubHistory()
    const wrapper = await openHistory()

    await focus(wrapper, 'field:history:exclude')
    await press(wrapper, 'Enter')

    const input = await vi.waitFor(() => {
      const found = wrapper.find<HTMLInputElement>('.add__input')
      expect(found.exists()).toBe(true)

      return found
    })
    await vi.waitFor(() => expect(document.activeElement).toBe(input.element))

    await input.setValue('https://www.Shop.example/cart')
    await wrapper.find('.add__form').trigger('submit')

    await vi.waitFor(() =>
      expect(writes.find((call) => call.method === 'PUT')?.body).toEqual({
        excludedDomains: ['bank.example', 'shop.example'],
      }),
    )
    await vi.waitFor(() => expect(wrapper.find('.add__form').exists()).toBe(false))
  })

  it('keeps the form open with the reason when what was typed is no domain', async () => {
    stubHistory()
    const wrapper = await openHistory()

    await focus(wrapper, 'field:history:exclude')
    await press(wrapper, 'Enter')
    await vi.waitFor(() => expect(wrapper.find('.add__input').exists()).toBe(true))

    await wrapper.find('.add__input').setValue('not a domain')
    await wrapper.find('.add__form').trigger('submit')

    await vi.waitFor(() => expect(wrapper.find('.add__error').text()).toMatch(/not a domain/))
    expect(writes.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('closes the form on escape without closing the section', async () => {
    stubHistory()
    const wrapper = await openHistory()

    await focus(wrapper, 'field:history:exclude')
    await press(wrapper, 'Enter')
    await vi.waitFor(() =>
      expect(document.activeElement?.classList.contains('add__input')).toBe(true),
    )

    await press(wrapper, 'Escape')

    expect(wrapper.find('.add__form').exists()).toBe(false)
    expect(window.location.hash).toBe('#/settings/history')
    expect(document.activeElement?.getAttribute('data-station')).toBe('field:history:exclude')
  })

  // Nothing undoes it, so the first press only asks.
  it('asks once before forgetting every page', async () => {
    stubHistory()
    const wrapper = await openHistory()

    await focus(wrapper, 'action:history:clear-history')
    await press(wrapper, 'Enter')

    expect(wrapper.text()).toContain('press again to forget all')
    expect(writes.some((call) => call.method === 'DELETE')).toBe(false)

    await press(wrapper, 'Enter')

    await vi.waitFor(() =>
      expect(writes.find((call) => call.method === 'DELETE')?.url).toBe('/api/history/entries'),
    )
    await vi.waitFor(() => expect(wrapper.text()).toContain('nothing is kept for you'))
  })

  it('asks once before forgetting one page, and leaves the caret in the list', async () => {
    stubHistory()
    const wrapper = await openHistory()

    await focus(wrapper, 'item:history:page:1')
    await press(wrapper, 'Enter')

    expect(wrapper.text()).toContain('press again to delete')

    await press(wrapper, 'Enter')

    await vi.waitFor(() =>
      expect(writes.find((call) => call.method === 'DELETE')?.url).toBe('/api/history/entries/1'),
    )
    await vi.waitFor(() =>
      expect(wrapper.find('[data-station="item:history:page:1"]').exists()).toBe(false),
    )
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('data-station')).toBe(
        'action:history:clear-history',
      ),
    )
  })

  it('stops excluding a domain without asking', async () => {
    stubHistory()
    const wrapper = await openHistory()

    await focus(wrapper, 'item:history:domain:bank.example')
    await press(wrapper, 'Enter')

    await vi.waitFor(() =>
      expect(writes.find((call) => call.method === 'PUT')?.body).toEqual({ excludedDomains: [] }),
    )
  })

  // The filter bar narrows an open section to what it holds, the way it finds a hidden repo.
  it('finds a kept page by its title through the filter bar', async () => {
    stubHistory()
    const wrapper = await openHistory()

    await wrapper.find('.launcher__input').setValue('diele')
    await nextTick()

    const items = wrapper.findAllComponents(SettingsItemRow).map((row) => row.props('item').id)
    expect(items).toEqual(['page:1'])
  })

  // The admin turning history off leaves what was kept reachable for forgetting, and nothing else.
  it('lists only what is kept, and the way to forget it, once the instance stops offering history', async () => {
    stubHistory({ ...STATE, available: false, enabled: false })
    const wrapper = await openHistory(undefined, 1)

    expect(wrapper.text()).toContain('no longer keeps history')
    expect(wrapper.findAllComponents(SettingsOptionRow)).toHaveLength(0)
    expect(wrapper.find('[data-station="field:history:exclude"]').exists()).toBe(false)
    expect(wrapper.find('[data-station="action:history:clear-history"]').exists()).toBe(true)

    await focus(wrapper, 'item:history:page:1')
    await press(wrapper, 'Enter')
    await press(wrapper, 'Enter')

    await vi.waitFor(() =>
      expect(writes.find((call) => call.method === 'DELETE')?.url).toBe('/api/history/entries/1'),
    )
    await vi.waitFor(() => expect(wrapper.text()).toContain('nothing is kept for you'))
  })

  it('says above the list when a page could not be forgotten, and keeps it', async () => {
    stubHistory(STATE, { writeStatus: 500 })
    const wrapper = await openHistory()

    await focus(wrapper, 'item:history:page:1')
    await press(wrapper, 'Enter')
    await press(wrapper, 'Enter')

    await vi.waitFor(() =>
      expect(wrapper.find('.settings__error').text()).toBe(
        'the portal did not forget that page, try again',
      ),
    )
    expect(wrapper.find('.settings__error').attributes('role')).toBe('alert')
    expect(wrapper.find('[data-station="item:history:page:1"]').exists()).toBe(true)
  })

  describe('forgetting with the pointer', () => {
    /**
     * Presses a row's forget button the way a pointer does: the press focuses the button, then
     * clicks it. Looked up afresh each time, the way a second click lands on whatever is drawn
     * there by then.
     * @param {VueWrapper} wrapper - The mounted view
     * @param {string} station - Station key of the row
     * @returns {Promise<void>}
     */
    async function clickForget(wrapper: VueWrapper, station: string): Promise<void> {
      const button = wrapper.find<HTMLButtonElement>(`[data-station="${station}"] .item__remove`)
      expect(button.exists()).toBe(true)

      button.element.focus()
      await button.trigger('click')
      await nextTick()
    }

    const deletes = (): ReadonlyArray<string> =>
      writes.filter((call) => call.method === 'DELETE').map((call) => call.url)

    it.each([
      ['while the portal offers history', STATE, 2],
      ['once the portal stopped offering it', { ...STATE, available: false, enabled: false }, 1],
    ])('forgets a page on the second click of its button %s', async (_case, state, rows) => {
      stubHistory(state)
      const wrapper = await openHistory(undefined, rows)

      await clickForget(wrapper, 'item:history:page:1')

      expect(deletes()).toEqual([])
      expect(wrapper.find('[data-station="item:history:page:1"] .item__remove').text()).toBe(
        'press again to delete',
      )
      // the press focused the button, which must still be there for the second one
      expect(document.activeElement?.classList.contains('item__remove')).toBe(true)

      await clickForget(wrapper, 'item:history:page:1')

      await vi.waitFor(() => expect(deletes()).toEqual(['/api/history/entries/1']))
      await vi.waitFor(() =>
        expect(wrapper.find('[data-station="item:history:page:1"]').exists()).toBe(false),
      )
    })

    it('disarms once the pointer moves focus somewhere else', async () => {
      stubHistory()
      const wrapper = await openHistory()

      await clickForget(wrapper, 'item:history:page:1')
      wrapper.find<HTMLInputElement>('.launcher__input').element.focus()
      await nextTick()

      expect(wrapper.find('[data-station="item:history:page:1"] .item__remove').text()).toBe('del')

      await clickForget(wrapper, 'item:history:page:1')

      expect(deletes()).toEqual([])
    })

    it('stops excluding a domain on one click of its button', async () => {
      stubHistory()
      const wrapper = await openHistory()

      await clickForget(wrapper, 'item:history:domain:bank.example')

      await vi.waitFor(() =>
        expect(writes.find((call) => call.method === 'PUT')?.body).toEqual({ excludedDomains: [] }),
      )
    })

    it('forgets every page on the second click of its row', async () => {
      stubHistory()
      const wrapper = await openHistory()
      const row = wrapper.find('[data-station="action:history:clear-history"]')

      await row.trigger('click')
      expect(wrapper.text()).toContain('press again to forget all')
      expect(deletes()).toEqual([])

      await wrapper.find('[data-station="action:history:clear-history"]').trigger('click')

      await vi.waitFor(() => expect(deletes()).toEqual(['/api/history/entries']))
    })
  })

  describe('a long history', () => {
    const many: ApiHistoryEntry[] = Array.from({ length: 150 }, (_, index) => ({
      ...PAGE,
      id: index + 1,
      url: `https://site${index + 1}.example/`,
      title: `page ${index + 1}`,
    }))

    it('lists a hundred pages, and moves the caret onto the first of the next ones it lists', async () => {
      stubHistory({ ...STATE, kept: 150 }, { kept: many })
      const wrapper = await openHistory(undefined, 101)

      expect(wrapper.text()).toContain('Show 50 more')

      await focus(wrapper, 'action:history:more-pages')
      await press(wrapper, 'Enter')

      await vi.waitFor(() => expect(wrapper.findAllComponents(SettingsItemRow)).toHaveLength(151))
      expect(wrapper.find('[data-station="action:history:more-pages"]').exists()).toBe(false)
      await vi.waitFor(() =>
        expect(document.activeElement?.getAttribute('data-station')).toBe('item:history:page:101'),
      )
    })

    it('finds a page beyond the first hundred through the filter bar', async () => {
      stubHistory({ ...STATE, kept: 150 }, { kept: many })
      const wrapper = await openHistory(undefined, 101)

      await wrapper.find('.launcher__input').setValue('site140')
      await nextTick()

      const items = wrapper.findAllComponents(SettingsItemRow).map((row) => row.props('item').id)
      expect(items).toEqual(['page:140'])
    })

    it('puts the caret on the next page after forgetting one', async () => {
      stubHistory({ ...STATE, kept: 150 }, { kept: many })
      const wrapper = await openHistory(undefined, 101)

      await focus(wrapper, 'item:history:page:3')
      await press(wrapper, 'Enter')
      await press(wrapper, 'Enter')

      await vi.waitFor(() =>
        expect(wrapper.find('[data-station="item:history:page:3"]').exists()).toBe(false),
      )
      await vi.waitFor(() =>
        expect(document.activeElement?.getAttribute('data-station')).toBe('item:history:page:4'),
      )
      // the page past the first hundred moves up into the list rather than the list shrinking
      expect(wrapper.find('[data-station="item:history:page:101"]').exists()).toBe(true)
    })
  })
})
