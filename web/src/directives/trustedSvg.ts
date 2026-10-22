import type { Directive } from 'vue'

/**
 * Named in the api's Trusted Types header (api/src/site/contentSecurityPolicy.ts), so neither
 * side may rename it alone.
 */
export const SVG_POLICY_NAME = 'diele-svg'

// Opaque stand-in for `TrustedHTML`, which lib.dom does not declare yet.
export interface TrustedMarkup {
  readonly __trustedMarkup: unique symbol
}

// The slice of `window.trustedTypes` this file uses.
interface SvgPolicy {
  createHTML(markup: string): TrustedMarkup
}

interface PolicyFactory {
  createPolicy(name: string, rules: { createHTML(markup: string): string }): SvgPolicy
}

// undefined until first asked for, null where the browser has no Trusted Types
let policy: SvgPolicy | null | undefined

/**
 * Creates the one policy svg markup reaches the page through.
 *
 * `createHTML` passes the markup through unchanged: icons are sanitised on the way into the
 * database (api/src/icons/sanitize.ts) and only ever arrive here from `/api/config` or the icon
 * library, so what the policy adds is that this file is the only door, not a second sanitiser.
 * @returns {SvgPolicy | null} - The policy, or null where Trusted Types is missing or refused
 */
function createSvgPolicy(): SvgPolicy | null {
  const factory = (globalThis as { trustedTypes?: PolicyFactory }).trustedTypes
  if (!factory) {
    return null
  }

  // Refused only under an enforced header that does not name it, where the plain string that
  // follows is then refused as well and says so in the console.
  try {
    return factory.createPolicy(SVG_POLICY_NAME, { createHTML: (markup) => markup })
  } catch {
    return null
  }
}

/**
 * Wraps sanitised svg markup for `innerHTML`, as `TrustedHTML` where the browser has Trusted
 * Types and as the plain string where it does not.
 * @param {string} markup - Svg markup as the api served it
 * @returns {TrustedMarkup | string} - What to assign to `innerHTML`
 */
export function trustedSvg(markup: string): TrustedMarkup | string {
  if (policy === undefined) {
    policy = createSvgPolicy()
  }

  return policy ? policy.createHTML(markup) : markup
}

/**
 * Forgets the policy, so a test can install or remove `trustedTypes` and start over.
 * @returns {void}
 */
export function resetSvgPolicy(): void {
  policy = undefined
}

/**
 * Writes the element's content from the svg markup it is bound to.
 * @param {HTMLElement} el - Element to fill
 * @param {string | undefined} markup - Svg markup, or nothing for an empty element
 * @returns {void}
 */
function render(el: HTMLElement, markup: string | undefined): void {
  // innerHTML takes TrustedHTML as well, which lib.dom does not declare
  el.innerHTML = trustedSvg(markup ?? '') as string
}

/**
 * `v-svg`: inlines sanitised svg markup through the `diele-svg` policy.
 *
 * In place of `v-html`, which hands its string to Vue's own `vue` policy instead, and which
 * would rewrite the element on every render once the value is a fresh `TrustedHTML` each time.
 * Here the markup is compared and the content written only when it changed.
 */
export const vSvg: Directive<HTMLElement, string | undefined> = {
  mounted(el, binding) {
    render(el, binding.value)
  },
  updated(el, binding) {
    if (binding.value !== binding.oldValue) {
      render(el, binding.value)
    }
  },
}
