import type { ApiEntriesSource } from '@diele/common'
import type { RowTarget } from '@/types/portal'

/**
 * Picks the entries one connector type produced.
 *
 * By connector instance rather than by type on the entry itself, because the entries carry the
 * instance that fetched them and a portal may hold two of the same connector: both instances'
 * repos belong under the one feature that configures them.
 * @param {ReadonlyArray<RowTarget>} rows - Every row every connector produced
 * @param {ReadonlyArray<ApiEntriesSource>} sources - One per enabled connector instance
 * @param {string} featureId - Connector type the feature stands for
 * @returns {ReadonlyArray<RowTarget>} - The rows that type produced
 */
export function producedBy(
  rows: ReadonlyArray<RowTarget>,
  sources: ReadonlyArray<ApiEntriesSource>,
  featureId: string,
): ReadonlyArray<RowTarget> {
  const instances = new Set(
    sources.filter((source) => source.type === featureId).map((source) => source.connectorId),
  )

  return rows.filter((row) => row.connectorId !== undefined && instances.has(row.connectorId))
}
