import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import AdminView from '@/views/AdminView.vue'
import AdminEntryRow from '@/features/admin/AdminEntryRow.vue'
import AdminFeatureRow from '@/features/admin/AdminFeatureRow.vue'
import AdminAddRow from '@/features/admin/AdminAddRow.vue'
import AdminEntryForm from '@/features/admin/AdminEntryForm.vue'
import AdminField from '@/features/admin/AdminField.vue'
import ActionRow from '@/components/ActionRow.vue'
import { resetPortalConfig } from '@/composables/usePortalConfig'

const FEATURES = [
  {
    id: 'cards',
    label: 'Cards',
    description: 'the logo cards on the resting page',
    kind: 'builtin',
    produces: ['card'],
    fields: [
      { key: 'label', label: 'Label', input: 'text', required: true },
      { key: 'url', label: 'URL', input: 'url', required: true },
    ],
    collection: '/api/admin/links/card',
    count: 2,
    enabledCount: 2,
    toggleable: true,
    enabled: true,
  },
  {
    id: 'engines',
    label: 'Search engines',
    description: 'what Enter submits to',
    kind: 'builtin',
    produces: ['engine'],
    fields: [{ key: 'name', label: 'Name', input: 'text', required: true }],
    collection: '/api/admin/engines',
    count: 0,
    enabledCount: 0,
  },
]

const ROWS = [
  { id: 1, label: 'Grafana', url: 'https://grafana.example', enabled: true },
  { id: 2, label: 'Kuma', url: 'https://kuma.example', enabled: false },
]

const calls: Array<{ url: string; method: string; body?: unknown }> = []

/**
 * Answers the admin endpoints the view reads, and records every write.
 * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
 */
function stubApi() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })

    if (url.includes('/api/admin/features')) {
      return Promise.resolve(new Response(JSON.stringify({ features: FEATURES })))
    }

    if (url.includes('/api/admin/links/card')) {
      return Promise.resolve(new Response(JSON.stringify({ rows: ROWS })))
    }

    if (url.includes('/api/admin/icons')) {
      return Promise.resolve(new Response(JSON.stringify({ icons: [] })))
    }

    if (url.includes('/api/auth/me')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ id: 1, name: 'Ada', email: null, picture: null, canAdmin: true }),
        ),
      )
    }

    return Promise.resolve(new Response(JSON.stringify({ ok: true })))
  })
}

/**
 * Mounts the panel and waits for its features to arrive.
 * @returns {Promise<VueWrapper>} - The mounted panel
 */
async function open(): Promise<VueWrapper> {
  const wrapper = mount(AdminView, { attachTo: document.body })
  await vi.waitFor(() =>
    expect(wrapper.findAllComponents(AdminFeatureRow).length).toBeGreaterThan(0),
  )

  return wrapper
}

/**
 * Opens one feature and waits for its rows.
 * @param {VueWrapper} wrapper - The mounted panel
 * @param {string} id - Feature to expand
 * @returns {Promise<void>}
 */
async function expand(wrapper: VueWrapper, id: string): Promise<void> {
  const row = wrapper
    .findAllComponents(AdminFeatureRow)
    .find((feature) => feature.props('feature').id === id)!

  await row.trigger('click')
  await nextTick()
  await vi.waitFor(() => expect(wrapper.findAllComponents(AdminEntryRow).length).toBeGreaterThan(0))
}

beforeEach(() => {
  calls.length = 0
  localStorage.clear()
  window.location.hash = ''
  resetPortalConfig()
  vi.stubGlobal('fetch', stubApi())
})

afterEach(() => {
  resetPortalConfig()
  localStorage.clear()
  window.location.hash = ''
  vi.unstubAllGlobals()
})

describe('the feature list', () => {
  it('renders a row per configurable feature', async () => {
    const wrapper = await open()

    expect(wrapper.findAllComponents(AdminFeatureRow)).toHaveLength(FEATURES.length)
    expect(wrapper.text()).toContain('Cards')
    expect(wrapper.text()).toContain('Search engines')
  })

  it('closes the list with the actions that act on the whole portal', async () => {
    const wrapper = await open()
    const actions = wrapper.findAllComponents(ActionRow).map((row) => row.props('action').id)

    expect(actions.length).toBeGreaterThan(0)
    expect(actions).toContain('leave')
  })

  it('narrows to the features a term addresses', async () => {
    const wrapper = await open()

    await wrapper.find('input').setValue('engines')
    await nextTick()

    const labels = wrapper
      .findAllComponents(AdminFeatureRow)
      .map((row) => row.props('feature').label)
    expect(labels).toEqual(['Search engines'])
  })
})

describe('opening a feature', () => {
  it('fetches its rows and renders them', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')

    const rows = wrapper.findAllComponents(AdminEntryRow).map((row) => row.props('row').label)
    expect(rows).toEqual(['Grafana', 'Kuma'])
  })

  // The route owns which feature is open, so opening one survives a step back.
  it('puts the open feature in the address', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')

    expect(window.location.hash).toBe('#/admin/cards')
  })

  // Ahead of the rows rather than after them: behind a long list it is a scroll away from the
  // row that was just opened.
  it('offers the add row ahead of the entries', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')

    expect(wrapper.findComponent(AdminAddRow).exists()).toBe(true)
  })

  it('shows a disabled row as disabled rather than hiding it', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')

    const states = wrapper.findAllComponents(AdminEntryRow).map((row) => row.props('row').enabled)
    expect(states).toEqual([true, false])
  })
})

describe('what the panel writes', () => {
  it('reads the features before anything else', async () => {
    await open()

    expect(calls.some((call) => call.url.includes('/api/admin/features'))).toBe(true)
  })

  it('reads a feature rows only once it is opened', async () => {
    const wrapper = await open()
    expect(calls.some((call) => call.url.includes('/api/admin/links/card'))).toBe(false)

    await expand(wrapper, 'cards')
    expect(calls.some((call) => call.url.includes('/api/admin/links/card'))).toBe(true)
  })

  it('sends every write to the collection the feature named', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')

    // The row reports which action ran rather than one event per action, so the panel keeps
    // the mapping from action to request in one place.
    const row = wrapper.findAllComponents(AdminEntryRow)[0]!
    row.vm.$emit('run', 'toggle')
    await vi.waitFor(() => expect(calls.some((call) => call.method !== 'GET')).toBe(true))

    const writes = calls.filter((call) => call.method !== 'GET')
    expect(writes.length).toBeGreaterThan(0)
    expect(writes[0]!.url).toContain('/api/admin/links/card')
  })
})

describe('adding and editing a row', () => {
  /**
   * Opens the blank form under an expanded feature.
   * @param {VueWrapper} wrapper - The mounted panel
   * @returns {Promise<void>}
   */
  async function openForm(wrapper: VueWrapper): Promise<void> {
    wrapper.findComponent(AdminAddRow).vm.$emit('open')
    await vi.waitFor(() => expect(wrapper.findComponent(AdminEntryForm).exists()).toBe(true))
  }

  it('renders one control per field the feature declares', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')
    await openForm(wrapper)

    const keys = wrapper.findAllComponents(AdminField).map((field) => field.props('field').key)
    expect(keys).toEqual(['label', 'url'])
  })

  it('marks the fields the feature says are required', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')
    await openForm(wrapper)

    for (const field of wrapper.findAllComponents(AdminField)) {
      expect(field.props('field').required).toBe(true)
    }
  })

  it('posts what was typed to the feature own collection', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')
    await openForm(wrapper)

    const inputs = wrapper.findComponent(AdminEntryForm).findAll('input')
    await inputs[0]!.setValue('Prometheus')
    await inputs[1]!.setValue('https://prometheus.example')
    await wrapper.findComponent(AdminEntryForm).find('form').trigger('submit')

    await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))

    const post = calls.find((call) => call.method === 'POST')!
    expect(post.url).toContain('/api/admin/links/card')
    expect(post.body).toMatchObject({ label: 'Prometheus', url: 'https://prometheus.example' })
  })

  it('closes the form again on cancel, writing nothing', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')
    await openForm(wrapper)

    wrapper.findComponent(AdminEntryForm).vm.$emit('cancel')
    await vi.waitFor(() => expect(wrapper.findComponent(AdminEntryForm).exists()).toBe(false))

    expect(calls.some((call) => call.method !== 'GET')).toBe(false)
  })

  // Editing fills the form from the row rather than opening a blank one, so a save that leaves
  // a field alone keeps what was there.
  it('fills the form from the row being edited', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')

    wrapper.findAllComponents(AdminEntryRow)[0]!.vm.$emit('run', 'edit')
    await vi.waitFor(() => expect(wrapper.findComponent(AdminEntryForm).exists()).toBe(true))

    const values = wrapper
      .findComponent(AdminEntryForm)
      .findAll('input')
      .map((input) => (input.element as HTMLInputElement).value)

    expect(values).toContain('Grafana')
    expect(values).toContain('https://grafana.example')
  })
})

// An export is a file that gets mailed around; an import replaces the whole configuration.
describe('moving a configuration in and out', () => {
  it('offers both transfer actions among the closing rows', async () => {
    const wrapper = await open()
    const actions = wrapper.findAllComponents(ActionRow).map((row) => row.props('action').id)

    expect(actions).toContain('export')
    expect(actions).toContain('import')
  })

  it('reads the whole configuration when the export row is run', async () => {
    const wrapper = await open()
    const exportRow = wrapper
      .findAllComponents(ActionRow)
      .find((row) => row.props('action').id === 'export')!

    exportRow.props('action').run()
    await vi.waitFor(() =>
      expect(calls.some((call) => call.url.includes('/api/admin/export'))).toBe(true),
    )
  })
})

// A feature's entries are stations in the same list as the feature itself, which is what lets
// one pair of arrow keys reach everything.
describe('walking the panel by keyboard', () => {
  /**
   * Sends a key press to the panel, which owns one handler for the whole list.
   * @param {VueWrapper} wrapper - The mounted panel
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
    const container = wrapper.find('.admin').element
    const focused = document.activeElement as HTMLElement | null
    const target = focused && container.contains(focused) ? focused : container

    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
    await nextTick()
  }

  it('steps onto the first feature and down through the list', async () => {
    const wrapper = await open()

    await press(wrapper, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-station')).toBe('feature:cards')

    await press(wrapper, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-station')).toBe('feature:engines')
  })

  it('opens a feature with enter, stepping into its rows', async () => {
    const wrapper = await open()

    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'Enter')
    await vi.waitFor(() =>
      expect(wrapper.findAllComponents(AdminEntryRow).length).toBeGreaterThan(0),
    )

    expect(window.location.hash).toBe('#/admin/cards')

    await press(wrapper, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-station')).toBe('add:cards')
  })

  it('leaves the list on escape', async () => {
    const wrapper = await open()

    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'Escape')

    expect(document.activeElement?.getAttribute('data-station')).toBeNull()
  })

  it('switches a row off with its own key', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')

    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-station')).toBe('entry:cards:1')

    await press(wrapper, 'd')
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true))

    expect(calls.find((call) => call.method === 'PUT')!.url).toContain('/api/admin/links/card')
  })
})
