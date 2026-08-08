import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BrandTilde from '@/components/BrandTilde.vue'
import LoadingDots from '@/components/LoadingDots.vue'
import PortalHeader from '@/components/PortalHeader.vue'

afterEach(() => {
  window.location.hash = ''
})

describe('PortalHeader', () => {
  it('renders the wordmark and the line under it', () => {
    const wrapper = mount(PortalHeader, {
      props: { title: 'diele', subtitle: 'start page' },
      attachTo: document.body,
    })

    expect(wrapper.find('h1').text()).toContain('diele')
    expect(wrapper.text()).toContain('start page')
    wrapper.unmount()
  })

  it('carries the brand mark inside the lockup', () => {
    const wrapper = mount(PortalHeader, {
      props: { title: 'diele', subtitle: 'start page' },
      attachTo: document.body,
    })

    expect(wrapper.findComponent(BrandTilde).exists()).toBe(true)
    wrapper.unmount()
  })

  it('takes the wordmark back to the portal', async () => {
    window.location.hash = '/admin'

    const wrapper = mount(PortalHeader, {
      props: { title: 'diele', subtitle: 'start page' },
      attachTo: document.body,
    })

    await wrapper.find('.brand__home').trigger('click')

    expect(window.location.hash).toBe('#/')
    wrapper.unmount()
  })

  // A button rather than a link, and it says where it goes, since the wordmark alone does not.
  it('names what the wordmark does for a screen reader', () => {
    const wrapper = mount(PortalHeader, {
      props: { title: 'diele', subtitle: 'start page' },
      attachTo: document.body,
    })

    const home = wrapper.find('.brand__home')
    expect(home.attributes('aria-label')).toBe('Back to the portal')
    expect(home.attributes('type')).toBe('button')
    wrapper.unmount()
  })
})

describe('the decorative marks', () => {
  // Decorative graphics are hidden from assistive technology; the lockup's text carries the name.
  it('hides the brand mark from assistive technology', () => {
    const wrapper = mount(BrandTilde)

    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.attributes('focusable')).toBe('false')
  })

  it('renders the loading indicator', () => {
    expect(mount(LoadingDots).html()).toBeTruthy()
  })
})
