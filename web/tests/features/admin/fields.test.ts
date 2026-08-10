import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AdminField from '@/features/admin/AdminField.vue'
import AdminKeywordsField from '@/features/admin/AdminKeywordsField.vue'
import AdminSelectField from '@/features/admin/AdminSelectField.vue'
import CheckBox from '@/components/CheckBox.vue'
import type { ApiFieldSpec } from '@diele/common'

/**
 * Mounts one control of the admin form.
 * @param {ApiFieldSpec} field - Field the feature declared
 * @param {unknown} modelValue - Stored value
 * @returns {ReturnType<typeof mount>} - The mounted control
 */
function field(spec: ApiFieldSpec, modelValue: unknown = null) {
  return mount(AdminField, { props: { field: spec, modelValue }, attachTo: document.body })
}

describe('AdminKeywordsField', () => {
  it('renders a stored list back as one line', () => {
    const wrapper = mount(AdminKeywordsField, { props: { modelValue: ['metrics', 'dashboards'] } })

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('metrics, dashboards')
  })

  it('reads anything that is not a list as an empty line', () => {
    for (const stored of [null, undefined, 'metrics', 42, {}]) {
      const wrapper = mount(AdminKeywordsField, { props: { modelValue: stored } })

      expect((wrapper.find('input').element as HTMLInputElement).value, String(stored)).toBe('')
    }
  })

  it('splits what is typed on commas, dropping the blanks', async () => {
    const wrapper = mount(AdminKeywordsField, { props: { modelValue: [] } })

    await wrapper.find('input').setValue(' metrics ,, dashboards , ')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['metrics', 'dashboards']])
  })

  // Round-tripping every keystroke through the array would parse `graf,` back to `graf` and
  // delete the separator the moment it was typed.
  it('keeps a separator that has just been typed', async () => {
    const wrapper = mount(AdminKeywordsField, { props: { modelValue: [] } })

    await wrapper.find('input').setValue('graf,')
    await wrapper.setProps({ modelValue: ['graf'] })
    await nextTick()

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('graf,')
  })

  it('resyncs when the value changes for a reason other than typing', async () => {
    const wrapper = mount(AdminKeywordsField, { props: { modelValue: ['a'] } })

    await wrapper.setProps({ modelValue: ['x', 'y'] })
    await nextTick()

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('x, y')
  })
})

describe('AdminSelectField', () => {
  const options = [
    { value: 'https', label: 'https' },
    { value: 'http', label: 'http' },
  ]

  it('renders one option per choice', () => {
    const wrapper = mount(AdminSelectField, { props: { modelValue: 'http', options } })

    expect(wrapper.findAll('option').map((option) => option.text())).toEqual(['https', 'http'])
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('http')
  })

  // An unset select still paints its first option, so the form reads back what it appears to
  // say rather than submitting nothing while showing something.
  it('shows the first option while nothing is stored', () => {
    const wrapper = mount(AdminSelectField, { props: { modelValue: null, options } })

    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('https')
  })

  it('reports what was picked', async () => {
    const wrapper = mount(AdminSelectField, { props: { modelValue: null, options } })

    await wrapper.find('select').setValue('http')

    expect(wrapper.emitted('update:modelValue')).toEqual([['http']])
  })

  // A decorator this build knows but no instance of is worth showing: "there is no such thing"
  // and "it is not set up yet" are different answers.
  it('shows a choice that exists but cannot be taken, without letting it be taken', () => {
    const wrapper = mount(AdminSelectField, {
      props: {
        modelValue: 'http',
        options: [...options, { value: 'uptime-kuma', label: 'Uptime Kuma', disabled: true }],
      },
    })

    const rendered = wrapper.findAll('option')

    expect(rendered.map((option) => option.text())).toContain('Uptime Kuma')
    expect((rendered.at(-1)!.element as HTMLOptionElement).disabled).toBe(true)
    expect((rendered[0]!.element as HTMLOptionElement).disabled).toBe(false)
  })

  it('copes with a feature that declared no options at all', () => {
    const wrapper = mount(AdminSelectField, { props: { modelValue: null, options: [] } })

    expect(wrapper.findAll('option')).toHaveLength(0)
  })
})

describe('AdminField', () => {
  it('renders a text box for the ordinary inputs', () => {
    for (const input of ['text', 'url', 'template'] as const) {
      const wrapper = field({ key: 'label', label: 'Label', input })

      expect(wrapper.find('input').attributes('type'), input).not.toBe('checkbox')
    }
  })

  // Stored hashed and never returned, so the box must not offer to fill itself from a manager.
  it('renders a secret so a password manager does not fill it', () => {
    const wrapper = field({ key: 'token', label: 'Access token', input: 'secret' })

    expect(wrapper.find('input').attributes('autocomplete')).toBe('new-password')
  })

  it('renders a number field for a port', () => {
    const wrapper = field({ key: 'port', label: 'Port', input: 'number' }, 5173)

    expect(wrapper.find('input').attributes('type')).toBe('number')
  })

  it('renders a switch for a toggle, and reports it', async () => {
    const wrapper = field({ key: 'isAdmin', label: 'Administrator', input: 'toggle' }, false)

    expect(wrapper.findComponent(CheckBox).exists()).toBe(true)

    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([true])
  })

  it('renders the keywords control for a keyword list', () => {
    const wrapper = field({ key: 'keywords', label: 'Keywords', input: 'keywords' }, ['a'])

    expect(wrapper.findComponent(AdminKeywordsField).exists()).toBe(true)
  })

  it('renders the picker for a select', () => {
    const wrapper = field(
      {
        key: 'scheme',
        label: 'Scheme',
        input: 'select',
        options: [{ value: 'http', label: 'http' }],
      },
      'http',
    )

    expect(wrapper.findComponent(AdminSelectField).exists()).toBe(true)
  })

  it('shows the placeholder and hint the feature declared', () => {
    const wrapper = field({
      key: 'url',
      label: 'URL',
      input: 'url',
      placeholder: 'https://example.com',
      hint: 'where the card opens',
    })

    expect(wrapper.find('input').attributes('placeholder')).toBe('https://example.com')
    expect(wrapper.text()).toContain('where the card opens')
  })

  it('reports what was typed', async () => {
    const wrapper = field({ key: 'label', label: 'Label', input: 'text' }, '')

    await wrapper.find('input').setValue('Grafana')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['Grafana'])
  })

  // A number arrives as text from the DOM, and storing it as one would send a string where the
  // schema wants an integer.
  it('reports a number as a number', async () => {
    const wrapper = field({ key: 'port', label: 'Port', input: 'number' }, null)

    await wrapper.find('input').setValue('5173')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([5173])
  })

  // A field the feature says is unavailable is shown rather than hidden, so the form still
  // reads as the whole shape of the thing, and disabled so it cannot be filled in anyway.
  it('disables a field the feature marked unavailable', () => {
    const wrapper = field({
      key: 'label',
      label: 'Label',
      input: 'text',
      unavailable: 'not built yet',
    } as ApiFieldSpec)

    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
  })
})
