import { onScopeDispose, ref, watch, type Ref, type ShallowRef } from 'vue'

/**
 * Counts the columns a grid renders. `auto-fit` resolves its track count at layout time, so
 * the used value is the only place the number exists; anything still carrying a declaration
 * counts as unmeasurable and falls back to a single column.
 * @param {HTMLElement | null} element - Grid container, or null while it is not rendered
 * @returns {number} - Rendered column count, at least 1
 */
function countColumns(element: HTMLElement | null): number {
  if (!element) {
    return 1
  }

  const tracks = getComputedStyle(element).gridTemplateColumns.split(' ')
  return tracks.filter((track) => track.endsWith('px')).length || 1
}

/**
 * Tracks how many columns a grid element renders, following it across resizes and across
 * the element itself coming and going.
 * @param {Readonly<ShallowRef<HTMLElement | null>>} element - Template ref of the grid container
 * @returns {Ref<number>} - Reactive column count, 1 while there is nothing to measure
 */
export function useGridColumns(element: Readonly<ShallowRef<HTMLElement | null>>): Ref<number> {
  const columns = ref(1)

  // jsdom and older engines ship no observer, leaving the count at its measured value
  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          columns.value = countColumns(element.value)
        })

  watch(
    element,
    (current) => {
      observer?.disconnect()
      columns.value = countColumns(current)
      if (current) {
        observer?.observe(current)
      }
    },
    { immediate: true, flush: 'post' },
  )

  onScopeDispose(() => observer?.disconnect())

  return columns
}
