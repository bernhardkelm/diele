import { toHistoryTarget } from '@/features/portal/historyTargets'
import type { ListAction } from '@/helpers/listActions'
import { formatRelativeTime } from '@/helpers/relativeTime'
import type { SettingsItem, SettingsPagedItems } from '@/features/settings/settingsSections'
import type { ApiHistoryEntry } from '@diele/common'

/** Kept pages listed at once, and again on each press of the row listing more */
export const HISTORY_PAGE_SIZE = 100

/**
 * Builds the row of one kept page.
 * @param {ApiHistoryEntry} entry - Page as the api served it
 * @param {(id: number) => Promise<void>} remove - Forgets it
 * @returns {SettingsItem} - Its row
 */
function pageItem(entry: ApiHistoryEntry, remove: (id: number) => Promise<void>): SettingsItem {
  const page = toHistoryTarget(entry)
  const visits = `${entry.visits} visit${entry.visits === 1 ? '' : 's'}`

  return {
    kind: 'item',
    id: `page:${entry.id}`,
    label: page.name,
    detail: page.title ? `${page.display} · ${visits}` : visits,
    note: formatRelativeTime(entry.lastVisitedAt),
    removeTitle: `Forget ${page.name}`,
    confirm: true,
    remove: () => remove(entry.id),
  }
}

/**
 * Builds the row listing the next page of kept pages.
 * @param {number} hidden - How many are not listed yet
 * @param {() => void} showMore - Lists the next page
 * @returns {ListAction} - The row
 */
function moreRow(hidden: number, showMore: () => void): ListAction {
  const next = Math.min(hidden, HISTORY_PAGE_SIZE)

  return {
    kind: 'action',
    id: 'more-pages',
    label: `Show ${next} more`,
    description: `${hidden} older page${hidden === 1 ? '' : 's'} not listed yet`,
    trail: String(hidden),
    run: showMore,
  }
}

/**
 * Builds the kept pages as one paged run, so a long history lists its most recent pages rather
 * than thousands of rows, while a term still searches all of them.
 * @param {ReadonlyArray<ApiHistoryEntry>} kept - Every kept page, most recent first
 * @param {number} shown - How many are listed
 * @param {(id: number) => Promise<void>} remove - Forgets one page
 * @param {() => void} showMore - Lists the next page
 * @returns {SettingsPagedItems} - The run
 */
export function keptPages(
  kept: ReadonlyArray<ApiHistoryEntry>,
  shown: number,
  remove: (id: number) => Promise<void>,
  showMore: () => void,
): SettingsPagedItems {
  return {
    kind: 'paged',
    id: 'pages',
    items: kept.map((entry) => pageItem(entry, remove)),
    shown,
    more: (hidden) => moreRow(hidden, showMore),
  }
}
