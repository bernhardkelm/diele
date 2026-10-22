import { toHistoryTarget } from '@/features/portal/historyTargets'
import type { ListAction } from '@/helpers/listActions'
import { formatRelativeTime } from '@/helpers/relativeTime'
import {
  ITEM_DETAIL_WEIGHT,
  ITEM_LABEL_WEIGHT,
  type SettingsItem,
  type SettingsPagedItems,
} from '@/features/settings/settingsSections'
import type { ApiHistoryEntry } from '@diele/common'

/** Kept pages listed at once, and again on each press of the row listing more */
export const HISTORY_PAGE_SIZE = 100

// Rows built per kept list and the function forgetting a page, since a keystroke matches every
// kept page, and a long history is thousands of them that only change when the list does.
const built = new WeakMap<
  ReadonlyArray<ApiHistoryEntry>,
  { remove: (id: number) => Promise<void>; items: ReadonlyArray<SettingsItem> }
>()

/**
 * Builds the row of one kept page, with the fields it is searched over.
 * @param {ApiHistoryEntry} entry - Page as the api served it
 * @param {(id: number) => Promise<void>} remove - Forgets it
 * @returns {SettingsItem} - Its row
 */
function pageItem(entry: ApiHistoryEntry, remove: (id: number) => Promise<void>): SettingsItem {
  const page = toHistoryTarget(entry)
  const visits = `${entry.visits} visit${entry.visits === 1 ? '' : 's'}`
  const label = page.name
  const detail = page.title ? `${page.display} · ${visits}` : visits
  let dated: { note: string | undefined } | undefined

  return {
    kind: 'item',
    id: `page:${entry.id}`,
    label,
    detail,
    searchFields: [
      { text: label, weight: ITEM_LABEL_WEIGHT },
      { text: detail, weight: ITEM_DETAIL_WEIGHT },
    ],
    // formatted the first time a row renders, so only the listed pages ever format one
    get note() {
      dated ??= { note: formatRelativeTime(entry.lastVisitedAt) }
      return dated.note
    },
    removeTitle: `Forget ${label}`,
    confirm: true,
    remove: () => remove(entry.id),
  }
}

/**
 * Returns the rows of every kept page, building them only when the list or the function
 * forgetting a page is new.
 * @param {ReadonlyArray<ApiHistoryEntry>} kept - Every kept page, most recent first
 * @param {(id: number) => Promise<void>} remove - Forgets one page
 * @returns {ReadonlyArray<SettingsItem>} - One row per page, in order
 */
function keptItems(
  kept: ReadonlyArray<ApiHistoryEntry>,
  remove: (id: number) => Promise<void>,
): ReadonlyArray<SettingsItem> {
  const cached = built.get(kept)
  if (cached?.remove === remove) {
    return cached.items
  }

  const items = kept.map((entry) => pageItem(entry, remove))
  built.set(kept, { remove, items })

  return items
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
    items: keptItems(kept, remove),
    shown,
    more: (hidden) => moreRow(hidden, showMore),
  }
}
