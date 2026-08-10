import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { sortRows, useEntrySort } from '@/composables/useEntrySort'
import type { RowTarget } from '@/types/portal'

/**
 * Builds a row to order.
 * @param {string} name - Row name
 * @param {string | undefined} detail - Namespace shown as the second column
 * @param {string | undefined} timestamp - ISO timestamp of the last activity
 * @returns {RowTarget} - The row
 */
function row(name: string, detail?: string, timestamp?: string): RowTarget {
  return {
    ref: `row:${name}`,
    kind: 'row',
    name,
    url: `https://git.example/${name}`,
    ...(detail ? { detail } : {}),
    ...(timestamp ? { timestamp } : {}),
  }
}

const rows: ReadonlyArray<RowTarget> = [
  row('web', 'beta', '2026-01-02T00:00:00Z'),
  row('api', 'alpha', '2026-01-03T00:00:00Z'),
  row('docs', 'alpha', '2026-01-01T00:00:00Z'),
]

/**
 * Reads the names out of an ordered list.
 * @param {ReadonlyArray<RowTarget>} ordered - Rows in display order
 * @returns {string[]} - Their names
 */
function names(ordered: ReadonlyArray<RowTarget>): string[] {
  return ordered.map((entry) => entry.name)
}

describe('sortRows', () => {
  // Repos of the same namespace stay together.
  it('groups by the second column first when sorting by name', () => {
    expect(names(sortRows(rows, 'name', 'asc'))).toEqual(['api', 'docs', 'web'])
  })

  it('reverses on descending', () => {
    expect(names(sortRows(rows, 'name', 'desc'))).toEqual(['web', 'docs', 'api'])
  })

  it('orders by activity, newest first when descending', () => {
    expect(names(sortRows(rows, 'activity', 'desc'))).toEqual(['api', 'web', 'docs'])
  })

  it('orders by activity oldest first when ascending', () => {
    expect(names(sortRows(rows, 'activity', 'asc'))).toEqual(['docs', 'web', 'api'])
  })

  // Keeps the list stable when several rows share a timestamp.
  it('falls back to the name order for rows sharing a timestamp', () => {
    const tied = [
      row('web', 'beta', '2026-01-01T00:00:00Z'),
      row('api', 'alpha', '2026-01-01T00:00:00Z'),
    ]

    expect(names(sortRows(tied, 'activity', 'desc'))).toEqual(['api', 'web'])
    expect(names(sortRows(tied, 'activity', 'asc'))).toEqual(['api', 'web'])
  })

  it('copes with rows carrying no detail or no timestamp', () => {
    const sparse = [row('b'), row('a'), row('c', 'ns')]

    expect(() => sortRows(sparse, 'name', 'asc')).not.toThrow()
    expect(() => sortRows(sparse, 'activity', 'desc')).not.toThrow()
    expect(sortRows(sparse, 'name', 'asc')).toHaveLength(3)
  })

  it('leaves the input untouched', () => {
    const before = names(rows)
    sortRows(rows, 'activity', 'desc')

    expect(names(rows)).toEqual(before)
  })
})

describe('useEntrySort', () => {
  it('starts on the name column, ascending', () => {
    const { sortKey, sortDirection, sorted } = useEntrySort(rows)

    expect(sortKey.value).toBe('name')
    expect(sortDirection.value).toBe('asc')
    expect(names(sorted.value)).toEqual(['api', 'docs', 'web'])
  })

  it('flips the direction when the active column is chosen again', () => {
    const { sortDirection, sortBy } = useEntrySort(rows)

    sortBy('name')
    expect(sortDirection.value).toBe('desc')

    sortBy('name')
    expect(sortDirection.value).toBe('asc')
  })

  // Each column has the direction that reads as "most useful first".
  it('takes each column natural direction when switching to it', () => {
    const { sortKey, sortDirection, sortBy } = useEntrySort(rows)

    sortBy('activity')
    expect(sortKey.value).toBe('activity')
    expect(sortDirection.value).toBe('desc')

    sortBy('name')
    expect(sortDirection.value).toBe('asc')
  })

  it('reorders as the rows themselves arrive', () => {
    const source = ref<ReadonlyArray<RowTarget>>([])
    const { sorted } = useEntrySort(source)

    expect(sorted.value).toEqual([])

    source.value = rows
    expect(names(sorted.value)).toEqual(['api', 'docs', 'web'])
  })

  it('accepts a getter as well as a ref', () => {
    const { sorted } = useEntrySort(() => rows)

    expect(names(sorted.value)).toEqual(['api', 'docs', 'web'])
  })
})
