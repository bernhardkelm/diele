import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AdminSelectField from '@/features/admin/AdminSelectField.vue'

const OPTIONS = [
  { value: '', label: 'match automatically' },
  { value: 'nextcloud', label: 'nextcloud' },
]

describe('choosing from a list a source supplied', () => {
  it('paints the options it was given', () => {
    const wrapper = mount(AdminSelectField, { props: { modelValue: null, options: OPTIONS } })

    expect(wrapper.findAll('option').map((option) => option.text())).toEqual([
      'match automatically',
      'nextcloud',
    ])
  })

  // The options can come from a source, so a monitor renamed or an instance briefly unreachable
  // would otherwise paint the field blank over a binding that is still set.
  it('keeps a stored value the list does not carry', () => {
    const wrapper = mount(AdminSelectField, {
      props: { modelValue: 'gone-from-kuma', options: OPTIONS },
    })

    expect(wrapper.findAll('option').map((option) => option.attributes('value'))).toEqual([
      'gone-from-kuma',
      '',
      'nextcloud',
    ])
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('gone-from-kuma')
  })

  it('adds nothing when the stored value is one of the options', () => {
    const wrapper = mount(AdminSelectField, {
      props: { modelValue: 'nextcloud', options: OPTIONS },
    })

    expect(wrapper.findAll('option')).toHaveLength(2)
  })

  it('reads an empty choice back as nothing stored', async () => {
    const wrapper = mount(AdminSelectField, {
      props: { modelValue: 'nextcloud', options: OPTIONS },
    })

    await wrapper.find('select').setValue('')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null])
  })
})
