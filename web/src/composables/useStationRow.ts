import { computed, type ComputedRef } from 'vue'

export interface StationRowOptions {
  /** Station key, mirrored onto the element so the ring can find and focus it */
  stationKey: () => string
  /** Whether this row is the list's single tab stop */
  active: () => boolean | undefined
  /** Depth in the tree: a feature or a closing action is 1, a row inside one is 2 */
  level: 1 | 2
}

export interface StationRow {
  /** Bound onto the row's root element, so every row in the ring is addressable the same way */
  attrs: ComputedRef<Record<string, string | number>>
  /** Returns whether a key press belongs to the row itself rather than something inside it */
  ownsEvent: (event: Event) => boolean
}

/**
 * Makes an element a station in the admin keyboard ring.
 *
 * Every row is a `treeitem` the ring finds by its key and focuses, and only one of them is the
 * list's tab stop, so tabbing into the panel lands on the row the arrows left rather than
 * walking the whole list. Written four times before this, which is four chances for one row to
 * become unreachable by differing in a detail nobody would look at.
 * @param {StationRowOptions} options - The row's key, whether it holds the tab stop, and its depth
 * @returns {StationRow} - Attributes to bind and the guard for its key handler
 */
export function useStationRow(options: StationRowOptions): StationRow {
  const attrs = computed(() => ({
    role: 'treeitem',
    'aria-level': options.level,
    'data-station': options.stationKey(),
    tabindex: options.active() ? 0 : -1,
  }))

  /**
   * Returns whether the event is the row's own rather than one bubbling out of its contents.
   * A `d` typed into a form field must not disable the row that field belongs to.
   * @param {Event} event - Event being handled
   * @returns {boolean} - True when the row itself is the target
   */
  function ownsEvent(event: Event): boolean {
    return event.target === event.currentTarget
  }

  return { attrs, ownsEvent }
}
