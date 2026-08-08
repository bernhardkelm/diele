import type { Ref } from 'vue'

interface Station {
  readonly key: string
}

/**
 * Builds the collapse handler a station list needs: put the caret on the row being closed, then
 * take the route back to the bare list.
 *
 * Focus moves first and the route follows. The row being collapsed to survives the collapse, so
 * focusing it before its children are dropped needs no waiting for the list to be rebuilt, and
 * there is never a moment with focus on an element that has gone.
 * @param {Ref<ReadonlyArray<Station>>} stations - The keyboard ring, in render order
 * @param {(index: number) => void} focusAt - Moves focus to one station
 * @param {(id: string) => string} keyOf - Turns a section id into its station key
 * @param {() => void} leave - Takes the route back to the bare list
 * @returns {(id: string) => void} - Handler that collapses one section
 */
export function useCollapseToStation(
  stations: Ref<ReadonlyArray<Station>>,
  focusAt: (index: number) => void,
  keyOf: (id: string) => string,
  leave: () => void,
): (id: string) => void {
  return (id: string) => {
    const index = stations.value.findIndex((entry) => entry.key === keyOf(id))

    if (index >= 0) {
      focusAt(index)
    }

    leave()
  }
}
