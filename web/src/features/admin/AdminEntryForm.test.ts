import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AdminEntryForm from '@/features/admin/AdminEntryForm.vue'
import type { ApiFeature, ApiFieldSpec } from '@diele/common'

// What a card's fields look like once the liveness pair is appended: a select, then one selector
// per provider kind, each drawn only while the select names it.
const FIELDS: ReadonlyArray<ApiFieldSpec> = [
  { key: 'label', label: 'Label', input: 'text', required: true },
  {
    key: 'health',
    label: 'Liveness',
    input: 'select',
    options: [
      { value: '', label: 'off' },
      { value: 'http', label: 'HTTP probe' },
      { value: 'uptime-kuma:3', label: 'Uptime Kuma · home' },
    ],
  },
  {
    key: 'healthPath',
    label: 'Path',
    input: 'text',
    showWhen: { key: 'health', value: ['http'] },
  },
  {
    key: 'healthMonitor',
    label: 'Monitor',
    input: 'text',
    showWhen: { key: 'health', value: ['uptime-kuma:3'] },
  },
]

const FEATURE: ApiFeature = {
  id: 'cards',
  label: 'Cards',
  description: 'The logo cards on the resting page.',
  kind: 'builtin',
  produces: ['card'],
  fields: FIELDS,
  count: 0,
  enabledCount: 0,
}

/**
 * Mounts the form over a row.
 * @param {Record<string, unknown> | undefined} row - Row being edited, or nothing while adding
 * @returns {ReturnType<typeof mount>} - The mounted form
 */
function form(row?: Record<string, unknown>) {
  return mount(AdminEntryForm, {
    props: { feature: FEATURE, ...(row ? { row: { id: 1, ...row } } : {}) },
    attachTo: document.body,
  })
}

/**
 * Reads which fields the form is currently drawing.
 * @param {ReturnType<typeof mount>} wrapper - The mounted form
 * @returns {string[]} - Their labels
 */
function labelsOf(wrapper: ReturnType<typeof form>): string[] {
  return wrapper.findAll('.field__label').map((node) =>
    node
      .text()
      .replace(/\s*\*$/, '')
      .trim(),
  )
}

describe('AdminEntryForm', () => {
  it('draws only the selector belonging to the chosen provider', () => {
    expect(labelsOf(form({ label: 'Grafana', health: 'http', healthPath: '/healthz' }))).toEqual([
      'Label',
      'Liveness',
      'Path',
    ])

    expect(labelsOf(form({ label: 'Grafana', health: 'uptime-kuma:3' }))).toEqual([
      'Label',
      'Liveness',
      'Monitor',
    ])
  })

  it('draws no selector at all while nothing is bound', () => {
    expect(labelsOf(form({ label: 'Grafana', health: null }))).toEqual(['Label', 'Liveness'])
  })

  it('swaps the selector as the provider changes, without a save in between', async () => {
    const wrapper = form({ label: 'Grafana', health: 'http', healthPath: '/healthz' })

    await wrapper.find('select').setValue('uptime-kuma:3')

    expect(labelsOf(wrapper)).toEqual(['Label', 'Liveness', 'Monitor'])
  })

  // The hidden values still travel; which one is read is the server's business, decided from the
  // provider rather than from which boxes happened to be on screen.
  it('submits every field the feature declared, drawn or not', async () => {
    const wrapper = form({ label: 'Grafana', health: 'http', healthPath: '/healthz' })

    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      label: 'Grafana',
      health: 'http',
      healthPath: '/healthz',
      healthMonitor: null,
    })
  })
})
