import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AdminEntryRow from '@/features/admin/AdminEntryRow.vue'
import AdminFeatureRow from '@/features/admin/AdminFeatureRow.vue'
import StatusDot from '@/components/StatusDot.vue'
import type { ApiFeature, ApiRow } from '@diele/common'

const FEATURE = {
  id: 'uptime-kuma',
  label: 'Uptime Kuma',
  description: 'monitor states',
  kind: 'connector',
  produces: [],
  capabilities: ['health'],
  fields: [],
  count: 2,
  enabledCount: 2,
} as unknown as ApiFeature

/**
 * Mounts a connector's own row.
 * @param {Partial<ApiRow>} overrides - Row fields on top of a minimal connector row
 * @returns {ReturnType<typeof mount>} - The mounted row
 */
function entryRow(overrides: Partial<ApiRow> = {}) {
  return mount(AdminEntryRow, {
    props: {
      feature: FEATURE,
      row: { id: 1, label: 'home', ...overrides } as ApiRow,
      stationKey: 'entry:uptime-kuma:1',
      actions: [],
    },
  })
}

/**
 * Mounts the heading a connector's instances sit under.
 * @param {number | undefined} failingCount - How many instances last failed
 * @returns {ReturnType<typeof mount>} - The mounted row
 */
function featureRow(failingCount?: number) {
  return mount(AdminFeatureRow, {
    props: {
      feature: { ...FEATURE, failingCount } as ApiFeature,
      stationKey: 'feature:uptime-kuma',
      actions: [],
    },
  })
}

describe('a connector that is not answering', () => {
  // The detail line already carries the reason; this is what makes it findable without reading
  // every line in the panel.
  it('marks its own row', () => {
    const wrapper = entryRow({
      sync: { lastError: 'fetch failed (ECONNREFUSED)' },
    } as Partial<ApiRow>)
    const dot = wrapper.findComponent(StatusDot)

    expect(dot.exists()).toBe(true)
    expect(dot.props('status')).toEqual({ state: 'down', detail: 'fetch failed (ECONNREFUSED)' })
  })

  it('leaves a working one unmarked', () => {
    const wrapper = entryRow({
      sync: { lastOkAt: '2026-01-01 00:00', lastError: null },
    } as Partial<ApiRow>)

    expect(wrapper.findComponent(StatusDot).exists()).toBe(false)
  })

  // The rows of a feature are only loaded once it is opened, so a source that stopped working
  // would otherwise need opening to find.
  it('marks the heading its instances sit under', () => {
    expect(featureRow(1).findComponent(StatusDot).exists()).toBe(true)
    expect(featureRow(0).findComponent(StatusDot).exists()).toBe(false)
    expect(featureRow().findComponent(StatusDot).exists()).toBe(false)
  })

  it('says how many of them on the heading, for a reader who cannot see the dot', () => {
    expect(featureRow(1).findComponent(StatusDot).props('name')).toBe(
      'Uptime Kuma, 1 of 2 not answering',
    )
  })
})
