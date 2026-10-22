import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { resetSvgPolicy } from '@/directives/trustedSvg'
import ServiceCard from '@/features/portal/ServiceCard.vue'
import type { CardTarget } from '@/types/portal'

const ICON = '<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z" fill="currentColor"></path></svg>'

const card: CardTarget = {
  ref: 'card:1',
  kind: 'card',
  name: 'Grafana',
  url: 'https://grafana.example/',
  icon: ICON,
  color: '#f46800',
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetSvgPolicy()
})

describe('ServiceCard', () => {
  it('inlines the sanitised icon as markup rather than text', () => {
    const wrapper = mount(ServiceCard, { props: { service: card } })

    expect(wrapper.find('.card__icon svg path').attributes('d')).toBe('M0 0h8v8H0z')
  })

  it('inlines it through the diele-svg policy where the browser has Trusted Types', () => {
    const createHTML = vi.fn((markup: string) => markup)
    vi.stubGlobal('trustedTypes', {
      createPolicy: (_name: string, rules: { createHTML: (markup: string) => string }) => ({
        createHTML: (markup: string) => {
          const html = createHTML(rules.createHTML(markup))
          return { toString: () => html }
        },
      }),
    })

    const wrapper = mount(ServiceCard, { props: { service: card } })

    expect(createHTML).toHaveBeenCalledWith(ICON)
    expect(wrapper.find('.card__icon svg path').exists()).toBe(true)
  })
})
