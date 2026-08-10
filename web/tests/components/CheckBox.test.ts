import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CheckBox from '@/components/CheckBox.vue'

describe('CheckBox', () => {
  // It stays a real checkbox, so space toggles it, a label points at it, and assistive
  // technology reads it as one rather than as a span pretending.
  it('is a real checkbox underneath the glyph', () => {
    const wrapper = mount(CheckBox, { props: { modelValue: false } })
    const input = wrapper.find('input')

    expect(input.attributes('type')).toBe('checkbox')
    expect((input.element as HTMLInputElement).checked).toBe(false)
  })

  it('draws the glyph from the value', () => {
    expect(mount(CheckBox, { props: { modelValue: true } }).text()).toBe('[×]')
    expect(mount(CheckBox, { props: { modelValue: false } }).text()).toBe('[ ]')
  })

  // Found through `.check` rather than the root: the template opens with a comment, which makes
  // the component a fragment and leaves the wrapper pointing at that comment node.
  it('marks the on state for the style layer', () => {
    const on = mount(CheckBox, { props: { modelValue: true } }).find('.check')
    const off = mount(CheckBox, { props: { modelValue: false } }).find('.check')

    expect(on.classes()).toContain('check--on')
    expect(off.classes()).not.toContain('check--on')
  })

  it('emits the new value when toggled', async () => {
    const wrapper = mount(CheckBox, { props: { modelValue: false } })

    await wrapper.find('input').setValue(true)

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })

  it('emits false when switched back off', async () => {
    const wrapper = mount(CheckBox, { props: { modelValue: true } })

    await wrapper.find('input').setValue(false)

    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('redraws when the bound value changes', async () => {
    const wrapper = mount(CheckBox, { props: { modelValue: false } })

    await wrapper.setProps({ modelValue: true })

    expect(wrapper.text()).toBe('[×]')
    expect((wrapper.find('input').element as HTMLInputElement).checked).toBe(true)
  })

  // A checkbox inside a form answers Enter by submitting it, which leaves this the one control
  // in a form a keyboard cannot actually set.
  it('toggles on enter rather than submitting the form around it', async () => {
    const wrapper = mount(CheckBox, { props: { modelValue: false } })

    await wrapper.find('input').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })

  it('does not swallow the key on a box that cannot be set', async () => {
    const wrapper = mount(CheckBox, { props: { modelValue: false, disabled: true } })
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true })

    wrapper.find('input').element.dispatchEvent(event)

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })

  it('disables the control rather than only dimming it', () => {
    const wrapper = mount(CheckBox, { props: { modelValue: false, disabled: true } })

    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
  })

  // For a caller that renders no label of its own around the control.
  it('takes an accessible name when there is no label to point at it', () => {
    const wrapper = mount(CheckBox, { props: { modelValue: false, label: 'Stay signed in' } })

    expect(wrapper.find('input').attributes('aria-label')).toBe('Stay signed in')
  })

  it('hides the drawn glyph from assistive technology, since the input carries the state', () => {
    const wrapper = mount(CheckBox, { props: { modelValue: false } })

    expect(wrapper.find('.check__box').attributes('aria-hidden')).toBe('true')
  })
})
