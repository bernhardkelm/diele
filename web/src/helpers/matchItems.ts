import { MATCH_TIERS } from '@/helpers/matchTiers'
import { completeMatch, matchTyped, type FieldsMatch } from '@/helpers/scoreFields'
import type { SearchField } from '@/helpers/searchFields'
import type { SearchToken } from '@/helpers/searchTokens'

/** One item a query matched, or one kept whether or not it did. */
export interface ItemMatch<T> {
  readonly item: T
  /** Undefined only for an item kept without matching */
  readonly match: FieldsMatch | undefined
  /** Position in the source list */
  readonly order: number
}

/**
 * Matches every item against a query, leaving out the guesses a literal hit makes redundant: once
 * anything matches at substring or better, an item only a typo would find is dropped, since a
 * typo is worth offering when nothing else answers the term and noise beside a literal hit.
 *
 * That is why it runs in two passes. The first matches every item as typed; only an item that
 * pass left short is tried for typos, and only when the first pass found no literal hit, which
 * spares the costliest tier on almost every keystroke. An acronym is neither literal nor a guess:
 * it is kept either way, and on its own it does not set the guesses aside.
 * @param {ReadonlyArray<T>} items - Everything searchable, in source order
 * @param {(item: T) => ReadonlyArray<SearchField>} fieldsOf - Weighted texts an item is searched over
 * @param {ReadonlyArray<SearchToken>} tokens - Tokens the query split into
 * @param {(item: T) => boolean} [keep] - Items listed whatever they match, which a guess on them never makes literal
 * @returns {ReadonlyArray<ItemMatch<T>>} - What is left, in source order
 */
export function matchItems<T>(
  items: ReadonlyArray<T>,
  fieldsOf: (item: T) => ReadonlyArray<SearchField>,
  tokens: ReadonlyArray<SearchToken>,
  keep?: (item: T) => boolean,
): ReadonlyArray<ItemMatch<T>> {
  const typed = items.map((item) => {
    const fields = fieldsOf(item)
    return { item, fields, pass: matchTyped(fields, tokens) }
  })

  const literal = typed.some(
    (entry) => entry.pass.tier !== undefined && entry.pass.tier >= MATCH_TIERS.SUBSTRING,
  )
  const matched: ItemMatch<T>[] = []

  typed.forEach((entry, order) => {
    const kept = keep?.(entry.item) ?? false

    // short of a token as typed, so a typo is all that could still find it
    if (literal && !kept && entry.pass.tier === undefined) {
      return
    }

    const match = completeMatch(entry.fields, tokens, entry.pass)
    if (match || kept) {
      matched.push({ item: entry.item, match, order })
    }
  })

  return matched
}
