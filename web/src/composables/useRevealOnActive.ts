import { onMounted, toValue, watch, type MaybeRefOrGetter, type ShallowRef } from 'vue'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

export interface RevealOptions {
  /**
   * Reveals an entry that is already active the moment it mounts. Right for a match, which
   * only ever appears because a term produced it; wrong for a permanent entry, which starts
   * active on every load and would fight a scroll position the browser restored.
   */
  onMount?: boolean
}

/**
 * Scrolls an entry back into view whenever it takes the launcher highlight, so walking the
 * matches with the arrow keys never runs off either end of the window. Scrolling to the
 * nearest edge leaves an entry that is already on screen where it is, which keeps the page
 * still while the highlight moves within view.
 * @param {Readonly<ShallowRef<HTMLElement | null>>} element - Template ref on the entry's root element
 * @param {MaybeRefOrGetter<boolean | undefined>} isActive - Whether the entry currently holds the highlight
 * @param {RevealOptions} options - Whether an already-active entry reveals itself on mount
 * @returns {void}
 */
export function useRevealOnActive(
  element: Readonly<ShallowRef<HTMLElement | null>>,
  isActive: MaybeRefOrGetter<boolean | undefined>,
  options: RevealOptions = {},
): void {
  /**
   * Brings the element to the nearest visible edge.
   * @returns {void}
   */
  function reveal(): void {
    const reduced = window.matchMedia?.(REDUCED_MOTION).matches
    element.value?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }

  // a match can mount already highlighted, which is what a fresh term does to its first one
  onMounted(() => {
    if ((options.onMount ?? true) && toValue(isActive)) {
      reveal()
    }
  })

  // after the DOM settles, so the element is where it will be read from
  watch(
    () => toValue(isActive),
    (active) => {
      if (active) {
        reveal()
      }
    },
    { flush: 'post' },
  )
}
