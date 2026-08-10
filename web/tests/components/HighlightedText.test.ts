import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import HighlightedText from '@/components/HighlightedText.vue'

/**
 * Reassembles the rendered pieces. Not `wrapper.text()`: it trims each node, so a piece ending
 * in a space loses it and the reassembled string is not the text that went in.
 * @param {ReturnType<typeof mount>} wrapper - Mounted component
 * @returns {string} - The text as the browser shows it
 */
function rendered(wrapper: ReturnType<typeof mount>): string {
  return wrapper
    .findAll('span, mark')
    .map((node) => node.element.textContent ?? '')
    .join('')
}

describe('HighlightedText', () => {
  it('renders the text unmarked when nothing is being searched', () => {
    const wrapper = mount(HighlightedText, { props: { text: 'Uptime Kuma' } })

    expect(rendered(wrapper)).toBe('Uptime Kuma')
    expect(wrapper.findAll('mark')).toHaveLength(0)
  })

  it('marks the stretch the query matched', () => {
    const wrapper = mount(HighlightedText, { props: { text: 'Uptime Kuma', query: 'kuma' } })

    expect(wrapper.findAll('mark')).toHaveLength(1)
    expect(wrapper.find('mark').text()).toBe('Kuma')
    expect(rendered(wrapper)).toBe('Uptime Kuma')
  })

  it('renders the whole text however it was cut up', () => {
    for (const query of ['kuma', 'uptime kuma', 'ukm', 'zzz', '']) {
      const wrapper = mount(HighlightedText, { props: { text: 'Uptime Kuma', query } })

      expect(rendered(wrapper), query).toBe('Uptime Kuma')
    }
  })

  it('renders nothing at all for empty text', () => {
    const wrapper = mount(HighlightedText, { props: { text: '', query: 'kuma' } })

    expect(rendered(wrapper)).toBe('')
  })

  // The text is interpolated rather than injected, so markup in a label stays text.
  it('does not render markup carried in the text', () => {
    const wrapper = mount(HighlightedText, {
      props: { text: '<img src=x onerror=alert(1)>', query: 'img' },
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(rendered(wrapper)).toContain('<img src=x onerror=alert(1)>')
  })

  it('re-marks when the query changes', async () => {
    const wrapper = mount(HighlightedText, { props: { text: 'Uptime Kuma', query: 'kuma' } })
    expect(wrapper.find('mark').text()).toBe('Kuma')

    await wrapper.setProps({ query: 'uptime' })
    expect(wrapper.find('mark').text()).toBe('Uptime')
  })
})
