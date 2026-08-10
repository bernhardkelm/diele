import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusDot from '@/components/StatusDot.vue'
import type { HealthState } from '@diele/common'

/**
 * Mounts the dot for one status.
 * @param {HealthState} state - State to render
 * @param {number | undefined} uptime - Share of the last 24h the monitor was up
 * @param {string | undefined} detail - The source's own name for what it measured
 * @returns {ReturnType<typeof mount>} - The mounted dot
 */
function dot(state: HealthState, uptime?: number, detail?: string) {
  return mount(StatusDot, { props: { status: { state, uptime, detail }, name: 'Grafana' } })
}

describe('StatusDot', () => {
  it('carries the state as a class, so the token layer colours it', () => {
    for (const state of ['up', 'down', 'pending', 'maintenance', 'unknown'] as const) {
      expect(dot(state).classes(), state).toContain(`status--${state}`)
    }
  })

  it('names the service and its state in words', () => {
    expect(dot('up').text()).toBe('Grafana: up')
    expect(dot('down').text()).toBe('Grafana: down')
    expect(dot('pending').text()).toBe('Grafana: pending')
    expect(dot('maintenance').text()).toBe('Grafana: in maintenance')
  })

  it('adds the uptime when the monitor reports one', () => {
    expect(dot('up', 0.9973).text()).toBe('Grafana: up, 99.73% uptime over 24h')
  })

  it('leaves the uptime out when there is none', () => {
    expect(dot('up').text()).toBe('Grafana: up')
  })

  it('reports a full and an empty window without rounding either away', () => {
    expect(dot('up', 1).text()).toContain('100.00% uptime')
    expect(dot('down', 0).text()).toContain('0.00% uptime')
  })

  // The same text the pointer gets on hover and a screen reader gets from the label.
  it('titles the dot with what it says', () => {
    const wrapper = dot('up', 0.5)

    expect(wrapper.attributes('title')).toBe(wrapper.text())
  })

  // A source that could not be reached knows nothing about the service, so the dot must not say
  // the service is down. It still has to be drawn: vanishing is how this went unnoticed.
  it('draws an unreachable source as its own state rather than as down', () => {
    const wrapper = dot('unknown')

    expect(wrapper.classes()).toContain('status--unknown')
    expect(wrapper.classes()).not.toContain('status--down')
    expect(wrapper.text()).toBe('Grafana: unknown, its source could not be reached')
  })

  it('names why the source could not be reached, when it was given a reason', () => {
    expect(dot('unknown', undefined, 'fetch failed (ECONNREFUSED)').text()).toContain(
      '(fetch failed (ECONNREFUSED))',
    )
  })
})
