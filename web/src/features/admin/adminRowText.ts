import type { ApiFeature, ApiRow } from '@diele/common'

/** What a connector row carries about its last run, alongside the fields it was configured with. */
interface RowSync {
  readonly lastOkAt?: string | null
  readonly lastError?: string | null
  readonly entryCount?: number
}

/**
 * Renders what a connector's last run did, which is where a token that quietly expired becomes
 * visible: the list keeps serving the entries of the last good run, so nothing else would say.
 *
 * A decorator is described by what it reads rather than by what it synced. It produces no
 * entries and the scheduler never runs it, so counting them and calling it a sync would report
 * a number that is always zero and a run that never happens.
 * @param {ApiRow} row - Row to describe
 * @param {ApiFeature | undefined} feature - Feature the row belongs to, for what it can do
 * @returns {string} - One line about the last run, empty for a row that does not sync
 */
function syncTextOf(row: ApiRow, feature?: ApiFeature): string {
  const sync = row.sync as RowSync | undefined
  if (!sync) {
    return ''
  }

  if (sync.lastError) {
    return `failing: ${sync.lastError}`
  }

  if (feature && !feature.capabilities?.includes('entries')) {
    return sync.lastOkAt ? `reporting, last read ${sync.lastOkAt}` : 'not read yet'
  }

  if (!sync.lastOkAt) {
    return 'never synced'
  }

  return `${sync.entryCount ?? 0} entries, synced ${sync.lastOkAt}`
}

/**
 * Renders a row's primary text, so the list reads without opening every entry.
 * @param {ApiRow} row - Row to describe
 * @returns {string} - Its name, or its keyword written the way it is typed
 */
export function summaryOf(row: ApiRow): string {
  if (row.keyword) {
    return `/${String(row.keyword)}`
  }

  return String(row.label ?? row.name ?? '')
}

/**
 * Renders a row's secondary text.
 * @param {ApiRow} row - Row to describe
 * @param {ApiFeature | undefined} feature - Feature the row belongs to, for what it can do
 * @returns {string} - Its url or template
 */
export function detailOf(row: ApiRow, feature?: ApiFeature): string {
  const sync = syncTextOf(row, feature)
  if (sync) {
    return sync
  }

  if (row.keyword) {
    return String(row.urlTemplate ?? row.label ?? '')
  }

  return String(row.url ?? row.urlTemplate ?? '')
}
