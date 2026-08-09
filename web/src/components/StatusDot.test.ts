import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusDot from '@/components/StatusDot.vue'
import type { HealthState } from '@diele/common'

/**
 * Mounts the dot for one status.
 * @param {HealthState} state - State to render
 * @param {number | undefined} uptime - Share of the last 24h the monitor was up
 * @returns {ReturnType<typeof mount>} - The mounted dot
 */
function dot(state: HealthState, uptime?: number) {
  return mount(StatusDot, { props: { status: { state, uptime }, name: 'Grafana' } })
}

describe('StatusDot', () => {
  it('carries the state as a class, so the token layer colours it', () => {
    for (const state of ['up', 'down', 'pending', 'maintenance'] as const) {
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
})
