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
import AdminHiddenRow from '@/features/admin/AdminHiddenRow.vue'
import { resetConnectorEntries } from '@/composables/useConnectorEntries'
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
  {
    id: 'gitlab',
    label: 'GitLab',
    description: 'repos of the token groups',
    kind: 'connector',
    produces: ['row'],
    capabilities: ['entries'],
    fields: [{ key: 'label', label: 'Label', input: 'text', required: true }],
    collection: '/api/admin/connectors/gitlab',
    count: 1,
    enabledCount: 1,
  },
]

// What the GitLab instance went and fetched, which is what the panel offers to keep from
// everyone. Separate from the rows above: those are the instances, these are their output.
const ENTRIES = {
  entries: [
    {
      ref: 'gitlab:1:web',
      connectorId: 1,
      connectorType: 'gitlab',
      kind: 'row',
      label: 'web',
      detail: 'example-group',
      url: 'https://gitlab.test/example-group/web',
      keywords: [],
      actions: [],
      timestamp: null,
      parentRef: null,
      searchOnly: false,
    },
    {
      ref: 'gitlab:1:api',
      connectorId: 1,
      connectorType: 'gitlab',
      kind: 'row',
      label: 'api',
      detail: 'example-group',
      url: 'https://gitlab.test/example-group/api',
      keywords: [],
      actions: [],
      timestamp: null,
      parentRef: null,
      searchOnly: false,
    },
  ],
  sources: [{ connectorId: 1, type: 'gitlab', label: 'Work', syncedAt: null, error: null }],
  hidden: { all: ['gitlab:1:api'], mine: [] },
}

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

    if (url.includes('/api/admin/connectors/gitlab')) {
      return Promise.resolve(
        new Response(JSON.stringify({ rows: [{ id: 1, label: 'Work', enabled: true }] })),
      )
    }

    // Before the hidden write, so the two are told apart by the more specific path first.
    if (url.includes('/api/entries/hidden')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true })))
    }

    if (url.includes('/api/entries')) {
      return Promise.resolve(new Response(JSON.stringify(ENTRIES)))
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
  resetConnectorEntries()
  vi.stubGlobal('fetch', stubApi())
})

afterEach(() => {
  resetPortalConfig()
  resetConnectorEntries()
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

  // On every view rather than the portal alone: whoever is looking at the admin panel is at
  // least as likely to be the one wondering how it works.
  it('carries the docs link the portal carries', async () => {
    const wrapper = await open()

    expect(wrapper.find('.page-footer a').attributes('href')).toBe(
      'https://github.com/bernhardkelm/diele',
    )
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
// Keeping an entry from everyone changes what every account sees, so it belongs beside the
// connector that produced the entry rather than on a personal settings page.
describe('keeping a produced entry from everyone', () => {
  /**
   * Opens the GitLab feature, then the connection whose entries the switches belong to.
   * @returns {Promise<VueWrapper>} - The mounted panel, with both levels open
   */
  async function openConnection(): Promise<VueWrapper> {
    const wrapper = await open()
    const feature = wrapper
      .findAllComponents(AdminFeatureRow)
      .find((row) => row.props('feature').id === 'gitlab')!

    await feature.trigger('click')
    await nextTick()
    await vi.waitFor(() => expect(wrapper.findAllComponents(AdminEntryRow).length).toBe(1))

    // the connection itself, whose settings the repos are listed under
    await wrapper.findAllComponents(AdminEntryRow)[0]!.trigger('click')
    await nextTick()

    return wrapper
  }

  // Under the connection rather than the feature: with two of them, the second one's repos would
  // otherwise sit behind the whole of the first one's.
  it('shows nothing until the connection itself is opened', async () => {
    const wrapper = await open()
    const feature = wrapper
      .findAllComponents(AdminFeatureRow)
      .find((row) => row.props('feature').id === 'gitlab')!

    await feature.trigger('click')
    await nextTick()
    await vi.waitFor(() => expect(wrapper.findAllComponents(AdminEntryRow).length).toBe(1))

    expect(wrapper.findAllComponents(AdminHiddenRow)).toHaveLength(0)
  })

  it('offers one switch per entry the open connection produced', async () => {
    const wrapper = await openConnection()
    const switches = wrapper.findAllComponents(AdminHiddenRow)

    expect(switches.map((row) => row.props('entry').ref)).toEqual(['gitlab:1:api', 'gitlab:1:web'])
    expect(switches.map((row) => row.props('hidden'))).toEqual([true, false])
  })

  // One level deeper than the connection, so the three read as one ladder.
  it('sits a level below the connection it hangs from', async () => {
    const wrapper = await openConnection()

    expect(wrapper.findAllComponents(AdminHiddenRow)[0]!.attributes('aria-level')).toBe('3')
  })

  it('writes the everyone scope, which is the one an admin alone may reach', async () => {
    const wrapper = await openConnection()

    await wrapper
      .findAllComponents(AdminHiddenRow)
      .find((row) => row.props('entry').ref === 'gitlab:1:web')!
      .trigger('click')

    await vi.waitFor(() =>
      expect(calls.some((call) => call.url.includes('/api/entries/hidden'))).toBe(true),
    )

    expect(calls.find((call) => call.url.includes('/api/entries/hidden'))!.body).toEqual({
      ref: 'gitlab:1:web',
      scope: 'all',
      hidden: true,
    })
  })

  // A feature that fetches nothing opens onto its own rows and nothing else.
  it('offers no switches under a feature that produces no entries', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')

    expect(wrapper.findAllComponents(AdminHiddenRow)).toHaveLength(0)
  })
})

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

  /**
   * Marks the open form's controls as being on screen, which jsdom lays nothing out to be.
   * @param {VueWrapper} wrapper - The mounted panel
   * @returns {Array<HTMLElement>} - The controls a step walks through
   */
  function layOutForm(wrapper: VueWrapper): Array<HTMLElement> {
    const form = wrapper.find('.entry-form').element
    const controls = [...form.querySelectorAll<HTMLElement>('input, select, textarea, button')]

    for (const control of controls) {
      Object.defineProperty(control, 'offsetParent', { configurable: true, value: form })
    }

    return controls
  }

  // The index is what a step is measured from, and the caret going back to the field by any
  // route leaves the list behind: a step from there starts at the top rather than one past the
  // row the arrows were last on.
  it('starts at the top of the list once the caret is back in the field', async () => {
    const wrapper = await open()

    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-station')).toBe('feature:engines')

    wrapper.find<HTMLInputElement>('.launcher__input').element.focus()
    await nextTick()

    await press(wrapper, 'ArrowDown')

    expect(document.activeElement?.getAttribute('data-station')).toBe('feature:cards')
  })

  // A form stays open when a step walks out of it, so the way back in has to exist. Without it
  // the arrows only ever pass the row the form hangs from, and a form left by one keystroke
  // takes a click to get back into.
  it('steps into a form the row has open, from above and from below', async () => {
    const wrapper = await open()
    await expand(wrapper, 'cards')

    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'e')
    await vi.waitFor(() => expect(wrapper.findComponent(AdminEntryForm).exists()).toBe(true))

    const controls = layOutForm(wrapper)

    await press(wrapper, 'ArrowUp')
    expect(document.activeElement?.getAttribute('data-station')).toBe('entry:cards:1')

    await press(wrapper, 'ArrowDown')
    expect(document.activeElement).toBe(controls[0])

    // out of the bottom of the form, which leaves it open behind the row below
    for (let taken = 0; taken < controls.length; taken += 1) {
      await press(wrapper, 'ArrowDown')
    }

    expect(document.activeElement?.getAttribute('data-station')).toBe('entry:cards:2')

    await press(wrapper, 'ArrowUp')
    expect(document.activeElement).toBe(controls[controls.length - 1])
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
