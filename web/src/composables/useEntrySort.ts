import { computed, ref, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import type { RowTarget } from '@/types/portal'

export type EntrySortKey = 'name' | 'activity'
export type SortDirection = 'asc' | 'desc'

// Each column has the direction that reads as "most useful first": names run A-Z, activity
// starts with what changed last.
const NATURAL_DIRECTION: Record<EntrySortKey, SortDirection> = {
  name: 'asc',
  activity: 'desc',
}

export interface EntrySort {
  sortKey: Ref<EntrySortKey>
  sortDirection: Ref<SortDirection>
  /** Rows in display order; also the order the launcher's digit shortcuts count in */
  sorted: ComputedRef<ReadonlyArray<RowTarget>>
  /** Selects a column, or flips the direction when it is already the active one */
  sortBy: (key: EntrySortKey) => void
}

/**
 * Compares two rows by their second column, then by name within it.
 * @param {RowTarget} a - Left row
 * @param {RowTarget} b - Right row
 * @returns {number} - Negative, zero or positive, as Array.sort expects
 */
function compareByName(a: RowTarget, b: RowTarget): number {
  return (a.detail ?? '').localeCompare(b.detail ?? '') || a.name.localeCompare(b.name)
}

/**
 * Orders rows for display. Name sorting groups them by their second column first, so repos of
 * the same namespace stay together; activity sorting falls back to the name order for ties,
 * which keeps the list stable when several rows share a timestamp.
 * @param {ReadonlyArray<RowTarget>} rows - Rows to order
 * @param {EntrySortKey} key - Column to order by
 * @param {SortDirection} direction - Ascending or descending
 * @returns {ReadonlyArray<RowTarget>} - New ordered array, the input is left untouched
 */
export function sortRows(
  rows: ReadonlyArray<RowTarget>,
  key: EntrySortKey,
  direction: SortDirection,
): ReadonlyArray<RowTarget> {
  const factor = direction === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    if (key === 'name') {
      return compareByName(a, b) * factor
    }

    const byActivity = (a.timestamp ?? '').localeCompare(b.timestamp ?? '')

    return byActivity === 0 ? compareByName(a, b) : byActivity * factor
  })
}

/**
 * Holds the row list's sort column and direction, defaulting to namespace then name.
 * @param {MaybeRefOrGetter<ReadonlyArray<RowTarget>>} rows - Rows to order, reactive so async ones join later
 * @returns {EntrySort} - Reactive sort state and the ordered list
 */
export function useEntrySort(rows: MaybeRefOrGetter<ReadonlyArray<RowTarget>>): EntrySort {
  const sortKey = ref<EntrySortKey>('name')
  const sortDirection = ref<SortDirection>(NATURAL_DIRECTION.name)

  const sorted = computed(() => sortRows(toValue(rows), sortKey.value, sortDirection.value))

  /**
   * Selects a sort column, flipping the direction when it is already active.
   * @param {EntrySortKey} key - Column to sort by
   * @returns {void}
   */
  function sortBy(key: EntrySortKey): void {
    if (sortKey.value === key) {
      sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
      return
    }

    sortKey.value = key
    sortDirection.value = NATURAL_DIRECTION[key]
  }

  return { sortKey, sortDirection, sorted, sortBy }
}
