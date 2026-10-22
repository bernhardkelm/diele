import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SignedOutBanner from '@/features/portal/SignedOutBanner.vue'

/**
 * Mounts the banner over a session in the given state.
 * @param {boolean} lapsed - Whether the session has ended
 * @returns {ReturnType<typeof mount>} - The mounted banner
 */
function banner(lapsed: boolean) {
  return mount(SignedOutBanner, { props: { lapsed }, attachTo: document.body })
}

describe('SignedOutBanner', () => {
  it('says nothing while the session holds', () => {
    const wrapper = banner(false)

    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  // Mounted either way, so the line appearing is a change inside a region a screen reader is
  // already watching rather than a new one it may not announce.
  it('keeps its polite region standing whether or not it has a line', async () => {
    const wrapper = banner(false)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    await wrapper.setProps({ lapsed: true })

    expect(wrapper.find('[role="status"]').text()).toContain('Signed out')
  })

  it('offers a real button, so the keyboard reaches it', () => {
    const wrapper = banner(true)
    const button = wrapper.find('button')

    expect(button.attributes('type')).toBe('button')
    expect(button.text()).toBe('sign in')

    const element = button.element as HTMLButtonElement
    element.focus()
    expect(document.activeElement).toBe(element)
  })

  it('asks to sign in when pressed, leaving how to the page', async () => {
    const wrapper = banner(true)

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('signIn')).toHaveLength(1)
  })
})
