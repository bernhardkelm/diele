import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { ApiHidden } from '@diele/common'
import SettingsView from '@/views/SettingsView.vue'
import SettingsSectionRow from '@/features/settings/SettingsSectionRow.vue'
import SettingsOptionRow from '@/features/settings/SettingsOptionRow.vue'
import ActionRow from '@/components/ActionRow.vue'
import { resetPortalConfig } from '@/composables/usePortalConfig'
import { resetConnectorEntries } from '@/composables/useConnectorEntries'
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
