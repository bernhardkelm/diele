import { describe, expect, it } from 'vitest'
import { producedBy } from '@/features/admin/producedEntries'
import type { ApiEntriesSource } from '@diele/common'
import type { RowTarget } from '@/types/portal'

const SOURCES: ReadonlyArray<ApiEntriesSource> = [
  { connectorId: 1, type: 'gitlab', label: 'Work', syncedAt: null, error: null },
  { connectorId: 2, type: 'gitlab', label: 'Personal', syncedAt: null, error: null },
  { connectorId: 3, type: 'github', label: 'Mirror', syncedAt: null, error: null },
]

/**
 * Builds a row one connector instance produced.
 * @param {string} ref - Its stable identity
 * @param {number | undefined} connectorId - Instance that fetched it
 * @returns {RowTarget} - The row
 */
function row(ref: string, connectorId: number | undefined): RowTarget {
  return { ref, kind: 'row', name: ref, url: `https://g.test/${ref}`, connectorId }
}

describe('producedBy', () => {
  // A portal may hold two of the same connector, and both instances' repos belong under the one
  // feature that configures them.
  it('takes the rows of every instance of that type', () => {
    const rows = [row('a', 1), row('b', 2), row('c', 3)]

    expect(producedBy(rows, SOURCES, 'gitlab').map((entry) => entry.ref)).toEqual(['a', 'b'])
  })

  it('leaves out the rows of another type', () => {
    expect(producedBy([row('c', 3)], SOURCES, 'gitlab')).toEqual([])
  })

  // A cached entry from a connector since deleted names an instance no source reports.
  it('leaves out a row whose instance is no longer listed', () => {
    expect(producedBy([row('a', 9), row('b', undefined)], SOURCES, 'gitlab')).toEqual([])
  })

  it('answers nothing for a feature no connector produced for', () => {
    expect(producedBy([row('a', 1)], SOURCES, 'notion')).toEqual([])
  })
})
