import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import StyleguideView from '@/views/StyleguideView.vue'
import StyleguideTokenRow from '@/features/styleguide/StyleguideTokenRow.vue'
import CommandRow from '@/features/portal/CommandRow.vue'
import ServiceCard from '@/features/portal/ServiceCard.vue'
import SiteRow from '@/features/portal/SiteRow.vue'
import StatusDot from '@/components/StatusDot.vue'
import CheckBox from '@/components/CheckBox.vue'
import AdminEntryRow from '@/features/admin/AdminEntryRow.vue'
import { resetPortalConfig } from '@/composables/usePortalConfig'
import { TOKEN_GROUPS } from '@/features/styleguide/styleguideTokens'
import { useTheme } from '@/composables/useTheme'

/**
 * Mounts the page with its config request left hanging, since nothing here waits on it.
 * @returns {Promise<VueWrapper>} - The mounted page
 */
async function open(): Promise<VueWrapper> {
  const wrapper = mount(StyleguideView, { attachTo: document.body })
  await vi.waitFor(() => expect(wrapper.findComponent(StyleguideTokenRow).exists()).toBe(true))

  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  resetPortalConfig()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  )
})

afterEach(() => {
  resetPortalConfig()
  useTheme().set('system')
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  vi.unstubAllGlobals()
})

describe('the token table', () => {
  it('renders a row for every token the catalogue lists', async () => {
    const wrapper = await open()
    const expected = TOKEN_GROUPS.reduce((total, group) => total + group.tokens.length, 0)

    expect(wrapper.findAllComponents(StyleguideTokenRow)).toHaveLength(expected)
  })

  it('names every group', async () => {
    const wrapper = await open()

    for (const group of TOKEN_GROUPS) {
      expect(wrapper.text()).toContain(group.title)
    }
  })

  it('names every token, so a missing declaration is visible as a blank value', async () => {
    const wrapper = await open()

    for (const token of TOKEN_GROUPS.flatMap((group) => group.tokens)) {
      expect(wrapper.text(), token.name).toContain(token.name)
    }
  })
})

// Specimens are fed to the real components rather than mimicked in markup, so the page cannot
// drift from what the portal actually renders.
describe('the specimens', () => {
  it('renders the real portal components rather than copies of them', async () => {
    const wrapper = await open()

    expect(wrapper.findAllComponents(CommandRow).length).toBeGreaterThan(0)
    expect(wrapper.findAllComponents(SiteRow).length).toBeGreaterThan(0)
    expect(wrapper.findComponent(ServiceCard).exists()).toBe(true)
    expect(wrapper.findComponent(StatusDot).exists()).toBe(true)
    expect(wrapper.findComponent(CheckBox).exists()).toBe(true)
  })

  it('renders the admin row alongside the portal ones, since both share the grammar', async () => {
    const wrapper = await open()

    expect(wrapper.findComponent(AdminEntryRow).exists()).toBe(true)
  })

  it('shows every state a status dot has', async () => {
    const wrapper = await open()
    const states = wrapper.findAllComponents(StatusDot).map((dot) => dot.props('status').state)

    expect(new Set(states)).toEqual(new Set(['up', 'down', 'pending', 'maintenance']))
  })
})

describe('switching theme on the page', () => {
  // The resolved values come from getComputedStyle, and nothing about that is reactive on its
  // own, so the table has to be re-read rather than left showing the other side.
  it('pins the document to the theme that was picked', async () => {
    const wrapper = await open()

    const dark = wrapper
      .findAll('button')
      .find((button) => button.text().toLowerCase().includes('dark'))
    expect(dark).toBeDefined()

    await dark!.trigger('click')

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('still renders every token row after the switch', async () => {
    const wrapper = await open()
    const before = wrapper.findAllComponents(StyleguideTokenRow).length

    const dark = wrapper
      .findAll('button')
      .find((button) => button.text().toLowerCase().includes('dark'))
    await dark!.trigger('click')

    expect(wrapper.findAllComponents(StyleguideTokenRow)).toHaveLength(before)
  })
})

// Only reachable while developing, and it is a reference rather than a route someone lands on
// by accident, so it says how to get back.
it('offers a way back to the portal', async () => {
  const wrapper = await open()

  expect(wrapper.find('.brand__home').exists()).toBe(true)
})
