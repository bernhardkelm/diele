import { describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ActionRow from '@/components/ActionRow.vue'
import EntriesLoading from '@/features/portal/EntriesLoading.vue'
import LauncherBar from '@/components/LauncherBar.vue'
import ScrollingText from '@/components/ScrollingText.vue'
import type { ListAction } from '@/helpers/listActions'

/**
 * Mounts the bar with whatever the test needs on top of a minimal set of props.
 * @param {Record<string, unknown>} props - Props to set
 * @returns {VueWrapper} - The mounted bar
 */
function bar(props: Record<string, unknown> = {}): VueWrapper {
  return mount(LauncherBar, {
    props: { modelValue: '', matchCount: 0, ...props },
    attachTo: document.body,
  })
}

describe('LauncherBar', () => {
  it('reports what is typed into it', async () => {
    const wrapper = bar()

    await wrapper.find('input').setValue('grafana')

    expect(wrapper.emitted('update:modelValue')).toEqual([['grafana']])
  })

  it('submits on enter, and asks for a new tab when a modifier is held', async () => {
    const wrapper = bar({ modelValue: 'grafana' })

    await wrapper.find('input').trigger('keydown.enter')
    await wrapper.find('input').trigger('keydown.enter', { metaKey: true })

    expect(wrapper.emitted('submit')).toEqual([[false], [true]])
  })

  // Enter would otherwise submit the form the field sits in and reload the page.
  it('keeps enter from doing anything else', async () => {
    const wrapper = bar()
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true })

    wrapper.find('input').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('names the engine and offers to switch it', async () => {
    const wrapper = bar({ engineName: 'DuckDuckGo' })
    const chip = wrapper.find('.launcher__engine')

    expect(chip.text()).toBe('DuckDuckGo')
    expect(chip.attributes('aria-label')).toContain('DuckDuckGo')

    await chip.trigger('click')
    expect(wrapper.emitted('cycleEngine')).toEqual([[1]])
  })

  it('hides the chip when there is no engine to name', () => {
    expect(bar().find('.launcher__engine').exists()).toBe(false)
  })

  // Nothing to clear on an empty field, so the control would be a button that does nothing.
  it('offers a clear only while there is a term', async () => {
    expect(bar().find('.launcher__clear').exists()).toBe(false)

    const wrapper = bar({ modelValue: 'grafana' })
    await wrapper.find('.launcher__clear').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
  })

  // The field is a station in the highlight ring like any row, so it carries the marker while
  // nothing in the list holds it.
  it('marks itself while no result is selected', () => {
    expect(bar().find('.launcher__field').classes()).toContain('launcher__field--marked')
    expect(bar({ hasSelection: true }).find('.launcher__field').classes()).not.toContain(
      'launcher__field--marked',
    )
  })

  it('takes a placeholder for a bar filtering something other than the portal', () => {
    const wrapper = bar({ placeholder: 'Filter the panel' })

    expect(wrapper.find('input').attributes('placeholder')).toBe('Filter the panel')
    expect(wrapper.find('input').attributes('aria-label')).toBe('Filter the panel')
  })

  it('falls back to naming what it searches', () => {
    expect(bar().find('input').attributes('aria-label')).toBe('Search anything')
  })

  it('renders the hints it was given instead of its own', () => {
    const wrapper = bar({ hints: [{ text: '↵ runs', key: true }, { text: 'esc leaves' }] })

    expect(wrapper.find('.launcher__hint').text()).toContain('↵ runs')
    expect(wrapper.find('.launcher__hint').text()).toContain('esc leaves')
  })
})

describe('ActionRow', () => {
  const action: ListAction = {
    kind: 'action',
    id: 'export',
    label: 'Export configuration',
    description: 'download everything as one file',
    run: vi.fn(),
  }

  it('renders the label and what running it does', () => {
    const wrapper = mount(ActionRow, { props: { action, stationKey: 'action:export' } })

    expect(wrapper.text()).toContain('Export configuration')
    expect(wrapper.findComponent(ScrollingText).props('text')).toBe(
      'download everything as one file',
    )
  })

  it('reports a run when clicked', async () => {
    const wrapper = mount(ActionRow, { props: { action, stationKey: 'action:export' } })
    await wrapper.trigger('click')

    expect(wrapper.emitted('run')).toHaveLength(1)
  })

  it('runs on enter, and only for a key press on the row itself', async () => {
    const wrapper = mount(ActionRow, { props: { action, stationKey: 'action:export' } })

    await wrapper.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('run')).toHaveLength(1)

    await wrapper.trigger('keydown', { key: 'a' })
    expect(wrapper.emitted('run')).toHaveLength(1)
  })

  it('does nothing at all while it is disabled', async () => {
    const wrapper = mount(ActionRow, {
      props: { action: { ...action, disabled: true }, stationKey: 'action:export' },
    })

    await wrapper.trigger('click')
    await wrapper.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('run')).toBeUndefined()
    expect(wrapper.attributes('aria-disabled')).toBe('true')
  })

  // Every row in the ring is addressable the same way, whatever kind it is.
  it('is a station in the ring, at whichever depth it was placed', () => {
    const flat = mount(ActionRow, { props: { action, stationKey: 'action:export' } })

    expect(flat.attributes('role')).toBe('treeitem')
    expect(flat.attributes('data-station')).toBe('action:export')
    expect(flat.attributes('aria-level')).toBe('1')

    for (const level of [2, 3] as const) {
      const nested = mount(ActionRow, { props: { action, stationKey: 'k', level } })

      expect(nested.attributes('aria-level'), String(level)).toBe(String(level))
    }
  })

  it('is the list tab stop only while it is the active row', () => {
    const active = mount(ActionRow, { props: { action, stationKey: 'k', active: true } })
    const idle = mount(ActionRow, { props: { action, stationKey: 'k' } })

    expect(active.attributes('tabindex')).toBe('0')
    expect(idle.attributes('tabindex')).toBe('-1')
  })

  it('shows the trail word when the action carries one', () => {
    const wrapper = mount(ActionRow, {
      props: { action: { ...action, trail: '3 items' }, stationKey: 'k' },
    })

    expect(wrapper.text()).toContain('3 items')
  })
})

describe('the smaller pieces', () => {
  it('renders the loading indicator with something for a reader', () => {
    const wrapper = mount(EntriesLoading)

    expect(wrapper.html()).toBeTruthy()
  })

  it('renders the text it was given', () => {
    const wrapper = mount(ScrollingText, { props: { text: 'a description that fits' } })

    expect(wrapper.text()).toContain('a description that fits')
  })

  it('re-renders when the text changes', async () => {
    const wrapper = mount(ScrollingText, { props: { text: 'first' } })
    await wrapper.setProps({ text: 'second' })

    expect(wrapper.text()).toContain('second')
    expect(wrapper.text()).not.toContain('first')
  })
})

// The field filters a region it does not itself render, so it says so rather than leaving a
// screen reader to infer the connection from the layout.
describe('what the field announces about itself', () => {
  it('presents itself as a combobox over the results it filters', () => {
    const wrapper = mount(LauncherBar, {
      props: { modelValue: '', matchCount: 3, controls: 'launcher-results' },
    })
    const input = wrapper.find('input')

    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-autocomplete')).toBe('list')
    expect(input.attributes('aria-controls')).toBe('launcher-results')
    expect(input.attributes('aria-expanded')).toBe('true')
  })

  it('reports nothing expanded while the term matches nothing', () => {
    const wrapper = mount(LauncherBar, { props: { modelValue: 'zzz', matchCount: 0 } })

    expect(wrapper.find('input').attributes('aria-expanded')).toBe('false')
  })

  // The arrow keys move a highlight rather than focus, so this region is the only thing that
  // says where the selection went.
  it('announces the count and the highlighted row', () => {
    const wrapper = mount(LauncherBar, {
      props: { modelValue: 'gra', matchCount: 2, activeName: 'Grafana' },
    })
    const status = wrapper.find('[role="status"]')

    expect(status.text()).toContain('2 matches')
    expect(status.text()).toContain('Grafana selected')
  })

  it('says one match in the singular', () => {
    const wrapper = mount(LauncherBar, { props: { modelValue: 'g', matchCount: 1 } })

    expect(wrapper.find('[role="status"]').text()).toContain('1 match')
    expect(wrapper.find('[role="status"]').text()).not.toContain('matches')
  })
})
