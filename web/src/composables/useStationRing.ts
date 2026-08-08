import { computed, nextTick, ref, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue'

/** Anything the ring can walk: a row that knows which station it is. */
export interface RingStation {
  readonly key: string
}

/**
 * Where focus should land once a mutation has reloaded the list. Every write in `useAdmin`
 * replaces the rows wholesale, so without an intent the element holding focus is discarded and
 * the caret falls back to the document body.
 */
export type FocusIntent =
  | { readonly type: 'station'; readonly key: string }
  | { readonly type: 'position'; readonly index: number }

export interface StationRing<T extends RingStation> {
  /** Index of the focused station, or -1 while the search field holds focus */
  activeIndex: Ref<number>
  active: ComputedRef<T | undefined>
  /** Whether focus sits on a row rather than in the search field */
  inList: ComputedRef<boolean>
  focusAt: (index: number) => void
  /** Steps through the ring, stepping off either end back into the search field */
  move: (delta: number) => void
  /** Hands focus back to the search field */
  leave: () => void
  /** Adopts a station the pointer put focus on, so clicking and arrowing agree */
  syncTo: (key: string) => void
  /** Puts focus back after a write has rebuilt the list */
  restore: (intent: FocusIntent) => Promise<void>
}

/**
 * Moves DOM focus through a list of stations, whatever the list is made of.
 *
 * Focus is real rather than painted, because a panel can hold text fields and destructive
 * actions: a row that is genuinely focused can answer a bare keystroke without competing with
 * the search field for it, and it is announced without an `aria-activedescendant` indirection.
 * @param {ComputedRef<ReadonlyArray<T>>} stations - The ring, in rendered order
 * @param {Readonly<ShallowRef<HTMLElement | null>>} list - Element the rows are rendered into
 * @param {() => void} focusField - Hands focus to the search field
 * @returns {StationRing<T>} - The ring's position and the ways to move it
 */
export function useStationRing<T extends RingStation>(
  stations: ComputedRef<ReadonlyArray<T>>,
  list: Readonly<ShallowRef<HTMLElement | null>>,
  focusField: () => void,
): StationRing<T> {
  const activeIndex = ref(-1)

  const active = computed(() => stations.value[activeIndex.value])
  const inList = computed(() => activeIndex.value >= 0)

  // The list is rebuilt whenever a section opens, a term narrows it or a write lands, and the
  // row holding focus moves within it. What is focused is the truth; the index only records
  // it, so it is re-read here rather than carried across a rebuild that invalidated it.
  watch(stations, (next) => {
    const key = focusedKey()
    const index = key ? next.findIndex((station) => station.key === key) : -1

    if (index >= 0) {
      activeIndex.value = index
      return
    }

    if (activeIndex.value >= next.length) {
      activeIndex.value = next.length - 1
    }
  })

  /**
   * Reads the station the document is actually focused on.
   * @returns {string | undefined} - Its key, or undefined when focus is outside the list
   */
  function focusedKey(): string | undefined {
    const element = document.activeElement
    if (!(element instanceof HTMLElement)) {
      return undefined
    }

    return element.closest<HTMLElement>('[data-station]')?.dataset.station
  }

  /**
   * Finds a station's rendered element.
   * @param {string} key - Station to look up
   * @returns {HTMLElement | null} - Its row, or null when it is not on screen
   */
  function elementFor(key: string): HTMLElement | null {
    return list.value?.querySelector<HTMLElement>(`[data-station="${key}"]`) ?? null
  }

  /**
   * Focuses one station by index.
   *
   * The index is only recorded once the element took focus, so it can never point somewhere
   * the caret is not. A station joins the ring the moment its section opens, which is a tick
   * before the row is rendered, so a step taken in that window finds nothing to focus and is
   * taken again once the list has caught up. Stepping down into a section that was just
   * expanded is exactly that window: the rows above it already exist, which is why stepping up
   * never had to wait.
   * @param {number} index - Station to focus
   * @returns {void}
   */
  function focusAt(index: number): void {
    const station = stations.value[index]
    if (!station) {
      return
    }

    const element = elementFor(station.key)

    if (element) {
      activeIndex.value = index
      element.focus()
      return
    }

    void nextTick().then(() => {
      // the list may have moved on again while this waited, so the station is looked up rather
      // than assumed to still be at the index it was asked for
      const late = elementFor(station.key)
      if (!late) {
        return
      }

      activeIndex.value = stations.value.findIndex((entry) => entry.key === station.key)
      late.focus()
    })
  }

  /**
   * Hands focus back to the search field.
   * @returns {void}
   */
  function leave(): void {
    activeIndex.value = -1
    focusField()
  }

  /**
   * Steps through the ring. The field is the station past either end rather than a wrap, so
   * arrowing off the list lands somewhere a term can be typed instead of silently jumping.
   * @param {number} delta - Stations to move by
   * @returns {void}
   */
  function move(delta: number): void {
    const count = stations.value.length
    if (count === 0) {
      leave()
      return
    }

    if (activeIndex.value < 0) {
      focusAt(delta > 0 ? 0 : count - 1)
      return
    }

    const next = activeIndex.value + delta
    if (next < 0 || next >= count) {
      leave()
      return
    }

    focusAt(next)
  }

  /**
   * Records where focus already is, without moving it.
   * @param {string} key - Station that took focus
   * @returns {void}
   */
  function syncTo(key: string): void {
    const index = stations.value.findIndex((station) => station.key === key)
    if (index >= 0) {
      activeIndex.value = index
    }
  }

  /**
   * Puts focus back once a write has rebuilt the list. A station that survived is found again
   * by key; one that was deleted hands focus to whatever took its place.
   * @param {FocusIntent} intent - Where focus should end up
   * @returns {Promise<void>}
   */
  async function restore(intent: FocusIntent): Promise<void> {
    await nextTick()

    if (intent.type === 'station') {
      const index = stations.value.findIndex((station) => station.key === intent.key)
      if (index >= 0) {
        focusAt(index)
        return
      }
    }

    const wanted = intent.type === 'position' ? intent.index : activeIndex.value
    const index = Math.min(wanted, stations.value.length - 1)

    if (index < 0) {
      leave()
      return
    }

    focusAt(index)
  }

  return { activeIndex, active, inList, focusAt, move, leave, syncTo, restore }
}
