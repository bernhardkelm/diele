import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AlertList from '@/features/portal/AlertList.vue'
import type { ApiSignal } from '@diele/common'

/**
 * Builds one signal as the API serves it.
 * @param {string} label - What is firing
 * @param {ApiSignal['severity']} severity - How loud it is
 * @param {Partial<ApiSignal>} extra - Whatever else the case is about
 * @returns {ApiSignal} - The signal
 */
function signal(
  label: string,
  severity: ApiSignal['severity'] = 'critical',
  extra: Partial<ApiSignal> = {},
): ApiSignal {
  return { id: label, label, severity, ...extra }
}

/**
 * Narrows a step the list was expected to have drawn, so the assertions below read it directly
 * rather than through an optional chain that would pass by being undefined.
 * @param {unknown} step - Wrapper found in the list
 * @returns {asserts step is { element: Element; trigger: (event: string, options?: object) => Promise<void> }}
 */
function assertStep(step: unknown): asserts step is {
  element: Element
  trigger: (event: string, options?: object) => Promise<void>
} {
  expect(step).toBeDefined()
}

/**
 * Mounts the list over a set of signals.
 * @param {ReadonlyArray<ApiSignal>} signals - What is firing, worst first
 * @param {boolean} forEveryone - Whether silencing speaks for the whole portal
 * @returns {ReturnType<typeof mount>} - The mounted list
 */
function list(signals: ReadonlyArray<ApiSignal>, forEveryone = false) {
  return mount(AlertList, { props: { signals, forEveryone }, attachTo: document.body })
}

describe('AlertList', () => {
  it('draws nothing at all while nothing is firing', () => {
    expect(list([]).find('section').exists()).toBe(false)
  })

  // One alert is worth reading outright; collapsing it would hide a single line behind a count
  // of one.
  it('shows a single alert as its own line', () => {
    const wrapper = list([signal('PostgresDown')])

    expect(wrapper.text()).toContain('PostgresDown')
    expect(wrapper.find('.alerts__summary').exists()).toBe(false)
  })

  it('collapses several behind a count', () => {
    const wrapper = list([signal('PostgresDown'), signal('DiskFilling', 'warning')])

    expect(wrapper.find('.alerts__summary').text()).toContain('2 alerts firing')
    expect(wrapper.find('.alerts__summary').attributes('aria-expanded')).toBe('false')
  })

  it('opens the collapsed line onto the alerts themselves', async () => {
    const wrapper = list([signal('PostgresDown'), signal('DiskFilling', 'warning')])

    await wrapper.find('.alerts__summary').trigger('click')

    expect(wrapper.find('.alerts__summary').attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(wrapper.text()).toContain('DiskFilling')
  })

  // The API orders these, so the summary reads the first rather than ranking them a second time.
  it('takes the collapsed line’s severity from the worst of them', () => {
    const wrapper = list([signal('PostgresDown'), signal('DiskFilling', 'warning')])

    expect(wrapper.find('.alerts__summary .alert-dot').classes()).toContain('alert-dot--critical')
  })

  // The dot carries severity in colour alone, so the word itself has to be somewhere.
  it('writes the severity out for a screen reader', () => {
    expect(list([signal('PostgresDown')]).text()).toContain('critical')
  })

  it('links a row to where the source shows it in full', () => {
    const wrapper = list([signal('PostgresDown', 'critical', { href: 'https://prom.test/alerts' })])

    expect(wrapper.find('a').attributes('href')).toBe('https://prom.test/alerts')
  })

  // A non-admin is served no href, and the row is then text rather than a dead link.
  it('leaves a row without a link as plain text, still reachable by keyboard', () => {
    const wrapper = list([signal('PostgresDown')])

    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.find('[data-alert-step]').attributes('tabindex')).toBe('0')
  })

  it('collapses itself again once the alerts clear', async () => {
    const wrapper = list([signal('PostgresDown'), signal('DiskFilling', 'warning')])

    await wrapper.find('.alerts__summary').trigger('click')
    await wrapper.setProps({ signals: [signal('PostgresDown')] })
    await wrapper.setProps({ signals: [signal('PostgresDown'), signal('DiskFilling', 'warning')] })

    expect(wrapper.find('.alerts__summary').attributes('aria-expanded')).toBe('false')
  })

  describe('silencing', () => {
    it('asks for the alert under the button, not whichever was first', async () => {
      const wrapper = list([signal('PostgresDown'), signal('DiskFilling', 'warning')])

      await wrapper.find('.alerts__summary').trigger('click')
      await wrapper.findAll('.alert__silence')[1]?.trigger('click')

      expect(wrapper.emitted('silence')).toEqual([['DiskFilling']])
    })

    // Silencing reaches further for an admin, so the row says which it is rather than leaving
    // someone to find out by watching everyone else's portal.
    it('says whether it speaks for the portal or for this account', () => {
      const mine = list([signal('PostgresDown')]).find('.alert__silence')
      const ours = list([signal('PostgresDown')], true).find('.alert__silence')

      expect(mine.attributes('title')).toBe('Silence PostgresDown until it clears')
      expect(ours.attributes('title')).toBe('Silence PostgresDown for everyone until it clears')
    })
  })

  describe('keyboard', () => {
    it('walks the rows with the arrows', async () => {
      const wrapper = list([signal('PostgresDown'), signal('DiskFilling', 'warning')])
      await wrapper.find('.alerts__summary').trigger('click')

      const [first, second] = wrapper.findAll('[data-alert-step]')
      assertStep(first)
      assertStep(second)
      ;(first.element as HTMLElement).focus()

      await first.trigger('keydown', { key: 'ArrowDown' })
      expect(document.activeElement).toBe(second.element)

      await second.trigger('keydown', { key: 'ArrowUp' })
      expect(document.activeElement).toBe(first.element)
    })

    // Tab is how the caret gets out of the region and into the search field below it.
    it('leaves Tab alone', async () => {
      const wrapper = list([signal('PostgresDown')])
      const step = wrapper.find('[data-alert-step]')

      await step.trigger('keydown', { key: 'Tab' })

      expect(wrapper.emitted()).not.toHaveProperty('silence')
    })

    it('stays put rather than wrapping at the ends', async () => {
      const wrapper = list([signal('PostgresDown')])
      const step = wrapper.find('[data-alert-step]')
      ;(step.element as HTMLElement).focus()

      await step.trigger('keydown', { key: 'ArrowUp' })

      expect(document.activeElement).toBe(step.element)
    })
  })
})
