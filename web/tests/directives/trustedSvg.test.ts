import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, withDirectives } from 'vue'
import { mount } from '@vue/test-utils'
import { resetSvgPolicy, SVG_POLICY_NAME, trustedSvg, vSvg } from '@/directives/trustedSvg'

const SQUARE = '<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"></path></svg>'
const CIRCLE = '<svg viewBox="0 0 8 8"><circle r="4"></circle></svg>'

/**
 * Installs a stand-in for `window.trustedTypes` whose values stringify to the markup they wrap,
 * the way a real `TrustedHTML` does when jsdom assigns it to `innerHTML`.
 * @returns {{ createPolicy: ReturnType<typeof vi.fn>, createHTML: ReturnType<typeof vi.fn> }} - The spies
 */
function stubTrustedTypes() {
  const createHTML = vi.fn()
  const createPolicy = vi.fn(
    (_name: string, rules: { createHTML: (markup: string) => string }) => ({
      createHTML: (markup: string) => {
        createHTML(markup)
        const html = rules.createHTML(markup)
        return { toString: () => html }
      },
    }),
  )

  vi.stubGlobal('trustedTypes', { createPolicy })

  return { createPolicy, createHTML }
}

/**
 * Mounts a bare span carrying `v-svg`, bound to a ref the test can change.
 * @param {string | undefined} initial - Markup to start from
 * @returns {{ wrapper: ReturnType<typeof mount>, markup: ReturnType<typeof ref<string | undefined>> }} - The mount and its binding
 */
function mountSpan(initial: string | undefined) {
  const markup = ref<string | undefined>(initial)
  const wrapper = mount(
    defineComponent({
      setup: () => () => withDirectives(h('span'), [[vSvg, markup.value]]),
    }),
  )

  return { wrapper, markup }
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetSvgPolicy()
})

describe('trustedSvg', () => {
  it('hands back the plain string where the browser has no Trusted Types', () => {
    expect(trustedSvg(SQUARE)).toBe(SQUARE)
  })

  it('wraps the markup through the diele-svg policy where it does, creating it once', () => {
    const { createPolicy, createHTML } = stubTrustedTypes()

    expect(String(trustedSvg(SQUARE))).toBe(SQUARE)
    expect(typeof trustedSvg(CIRCLE)).toBe('object')

    expect(createPolicy).toHaveBeenCalledTimes(1)
    expect(createPolicy.mock.calls[0]?.[0]).toBe(SVG_POLICY_NAME)
    expect(createHTML.mock.calls).toEqual([[SQUARE], [CIRCLE]])
  })

  // An enforced header that does not name the policy makes createPolicy throw; the page then
  // falls back to the string rather than failing to render at all.
  it('falls back to the plain string when the browser refuses the policy', () => {
    vi.stubGlobal('trustedTypes', {
      createPolicy: () => {
        throw new TypeError('policy not allowed')
      },
    })

    expect(trustedSvg(SQUARE)).toBe(SQUARE)
  })
})

describe('v-svg', () => {
  it('draws the markup without Trusted Types', () => {
    const { wrapper } = mountSpan(SQUARE)

    expect(wrapper.html()).toContain('M0 0h8v8H0z')
  })

  it('draws the markup through the policy with Trusted Types', () => {
    const { createHTML } = stubTrustedTypes()
    const { wrapper } = mountSpan(SQUARE)

    expect(wrapper.html()).toContain('M0 0h8v8H0z')
    expect(createHTML).toHaveBeenCalledWith(SQUARE)
  })

  it('redraws when the markup changes and leaves it alone when it does not', async () => {
    const { createHTML } = stubTrustedTypes()
    const { wrapper, markup } = mountSpan(SQUARE)

    markup.value = CIRCLE
    await nextTick()
    expect(wrapper.html()).toContain('<circle')

    wrapper.vm.$forceUpdate()
    await nextTick()
    expect(createHTML.mock.calls).toEqual([[SQUARE], [CIRCLE]])
  })

  it('leaves the element empty for no markup', () => {
    const { wrapper } = mountSpan(undefined)

    expect(wrapper.element.innerHTML).toBe('')
  })
})
