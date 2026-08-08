import { scoreFields } from '@/helpers/scoreFields'
import type { SearchField } from '@/helpers/searchFields'
import { tokenize } from '@/helpers/searchTokens'

export interface RankOptions<T> {
  /** Extra score an item has earned outside its fields, e.g. from being opened before */
  boostFor?: (item: T) => number
  /** Group an item ranks within; ranking never lifts an item across groups, ascending first */
  sectionOf?: (item: T) => number
}

/**
 * Filters items down to what a query matches and orders them by how well, best first. Ties keep
 * their source order, and an empty term returns the items untouched, so a list at rest stays in
 * the order it was configured.
 * @param {ReadonlyArray<T>} items - Everything searchable
 * @param {string} query - Raw search term as typed
 * @param {(item: T) => ReadonlyArray<SearchField>} fieldsOf - Weighted texts an item is searched over
 * @param {RankOptions<T>} [options] - Boost and section grouping, where a list needs them
 * @returns {ReadonlyArray<T>} - Matching items, ranked
 */
export function rankByScore<T>(
  items: ReadonlyArray<T>,
  query: string,
  fieldsOf: (item: T) => ReadonlyArray<SearchField>,
  options?: RankOptions<T>,
): ReadonlyArray<T> {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return items
  }

  const ranked: Array<{ item: T; section: number; score: number; order: number }> = []

  items.forEach((item, order) => {
    const score = scoreFields(fieldsOf(item), tokens)
    if (score === undefined) {
      return
    }

    ranked.push({
      item,
      section: options?.sectionOf?.(item) ?? 0,
      score: score + (options?.boostFor?.(item) ?? 0),
      order,
    })
  })

  ranked.sort((a, b) => a.section - b.section || b.score - a.score || a.order - b.order)

  return ranked.map((entry) => entry.item)
}
