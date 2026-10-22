import { dropGuesses } from '@/helpers/dropGuesses'
import type { MatchTier } from '@/helpers/matchTiers'
import { matchFields } from '@/helpers/scoreFields'
import type { SearchField } from '@/helpers/searchFields'
import { tokenize } from '@/helpers/searchTokens'

export interface RankOptions<T> {
  /** Extra score an item has earned outside its fields, e.g. from being opened before */
  boostFor?: (item: T) => number
}

/** One item a query matched, with what ranking it needs. */
export interface ScoredItem<T> {
  readonly item: T
  /** What its fields scored, before any boost */
  readonly score: number
  /** `score` plus the boost, which is what orders a list */
  readonly rank: number
  readonly tier: MatchTier
  /** Position in the source list, which breaks ties */
  readonly order: number
}

/**
 * Scores every item a query matches, in source order, leaving out the guesses a literal hit
 * makes redundant.
 * @param {ReadonlyArray<T>} items - Everything searchable
 * @param {string} query - Raw search term as typed
 * @param {(item: T) => ReadonlyArray<SearchField>} fieldsOf - Weighted texts an item is searched over
 * @param {RankOptions<T>} [options] - Boost, where a list has one
 * @returns {ReadonlyArray<ScoredItem<T>> | undefined} - Matches, or undefined for a blank query
 */
export function scoreItems<T>(
  items: ReadonlyArray<T>,
  query: string,
  fieldsOf: (item: T) => ReadonlyArray<SearchField>,
  options?: RankOptions<T>,
): ReadonlyArray<ScoredItem<T>> | undefined {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return undefined
  }

  const scored: ScoredItem<T>[] = []

  items.forEach((item, order) => {
    const match = matchFields(fieldsOf(item), tokens)
    if (!match) {
      return
    }

    scored.push({
      item,
      score: match.score,
      rank: match.score + (options?.boostFor?.(item) ?? 0),
      tier: match.tier,
      order,
    })
  })

  return dropGuesses(scored)
}

/**
 * Orders scored items best first, ties in source order.
 * @param {ScoredItem<T>} a - One item
 * @param {ScoredItem<T>} b - The other
 * @returns {number} - Negative when `a` goes first
 */
export function byRank<T>(a: ScoredItem<T>, b: ScoredItem<T>): number {
  return b.rank - a.rank || a.order - b.order
}

/**
 * Filters items down to what a query matches and orders them by how well, best first. Ties keep
 * their source order, and an empty term returns the items untouched, so a list at rest stays in
 * the order it was configured.
 * @param {ReadonlyArray<T>} items - Everything searchable
 * @param {string} query - Raw search term as typed
 * @param {(item: T) => ReadonlyArray<SearchField>} fieldsOf - Weighted texts an item is searched over
 * @param {RankOptions<T>} [options] - Boost, where a list has one
 * @returns {ReadonlyArray<T>} - Matching items, ranked
 */
export function rankByScore<T>(
  items: ReadonlyArray<T>,
  query: string,
  fieldsOf: (item: T) => ReadonlyArray<SearchField>,
  options?: RankOptions<T>,
): ReadonlyArray<T> {
  const scored = scoreItems(items, query, fieldsOf, options)
  if (!scored) {
    return items
  }

  return [...scored].sort(byRank).map((entry) => entry.item)
}
