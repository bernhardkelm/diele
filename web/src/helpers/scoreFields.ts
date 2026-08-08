import { fuzzyMatch } from '@/helpers/fuzzyMatch'
import type { SearchField } from '@/helpers/searchFields'

/**
 * Scores one item's fields against every token of a query.
 *
 * Each token has to hit something, so a second word narrows the result rather than widening it,
 * and a token scores on its best field alone so a name match is never diluted by the fields it
 * missed. A match never scores zero, so a zero best means nothing matched at all.
 * @param {ReadonlyArray<SearchField>} fields - Weighted texts the item is searched over
 * @param {ReadonlyArray<string>} tokens - Lowercased tokens the query split into
 * @returns {number | undefined} - Mean token score, or undefined when a token matched nothing
 */
export function scoreFields(
  fields: ReadonlyArray<SearchField>,
  tokens: ReadonlyArray<string>,
): number | undefined {
  if (tokens.length === 0) {
    return undefined
  }

  let total = 0

  for (const token of tokens) {
    let best = 0

    for (const field of fields) {
      const match = fuzzyMatch(field.text, token)
      if (match) {
        best = Math.max(best, match.score * field.weight)
      }
    }

    if (best === 0) {
      return undefined
    }

    total += best
  }

  return total / tokens.length
}
