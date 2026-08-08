import type { ApiRow } from '@diele/common'

/** What a connector row carries about its last run, alongside the fields it was configured with. */
interface RowSync {
  readonly lastOkAt?: string | null
  readonly lastError?: string | null
  readonly entryCount?: number
}

/**
 * Renders what a connector's last run did, which is where a token that quietly expired becomes
 * visible: the list keeps serving the entries of the last good run, so nothing else would say.
 * @param {ApiRow} row - Row to describe
 * @returns {string} - One line about the last run, empty for a row that does not sync
 */
function syncTextOf(row: ApiRow): string {
  const sync = row.sync as RowSync | undefined
  if (!sync) {
    return ''
  }

  if (sync.lastError) {
    return `failing: ${sync.lastError}`
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
 * @returns {string} - Its url or template
 */
export function detailOf(row: ApiRow): string {
  const sync = syncTextOf(row)
  if (sync) {
    return sync
  }

  if (row.keyword) {
    return String(row.urlTemplate ?? row.label ?? '')
  }

  return String(row.url ?? row.urlTemplate ?? '')
}
