import { fuzzyMatch } from '@/helpers/fuzzyMatch'
import { MATCH_TIERS, type MatchTier } from '@/helpers/matchTiers'
import type { SearchField } from '@/helpers/searchFields'
import type { SearchToken } from '@/helpers/searchTokens'

/** How well an item's fields answered a query. */
export interface FieldsMatch {
  /** Mean of each token's best weighted field score, never zero */
  readonly score: number
  /** Weakest tier any token needed, so a single guessed token marks the whole item a guess */
  readonly tier: MatchTier
}

/**
 * Matches one item's fields against every token of a query.
 *
 * Each token has to hit something, so a second word narrows the result rather than widening it,
 * and a token scores on its best field alone so a name match is never diluted by the fields it
 * missed. Its tier is read apart from that score, unweighted: a token that appears literally in
 * any field was not a guess, even where a typo on a heavier field scores higher.
 * @param {ReadonlyArray<SearchField>} fields - Weighted texts the item is searched over
 * @param {ReadonlyArray<SearchToken>} tokens - Tokens the query split into
 * @returns {FieldsMatch | undefined} - Score and tier, or undefined when a token matched nothing
 */
export function matchFields(
  fields: ReadonlyArray<SearchField>,
  tokens: ReadonlyArray<SearchToken>,
): FieldsMatch | undefined {
  if (tokens.length === 0) {
    return undefined
  }

  let total = 0
  let weakest: MatchTier = MATCH_TIERS.EXACT

  for (const token of tokens) {
    let best = 0
    let tier: MatchTier | undefined

    for (const field of fields) {
      const match = fuzzyMatch(field.text, token)
      if (match) {
        best = Math.max(best, match.score * field.weight)
        tier = tier === undefined ? match.tier : (Math.max(tier, match.tier) as MatchTier)
      }
    }

    if (tier === undefined || best === 0) {
      return undefined
    }

    total += best
    weakest = Math.min(weakest, tier) as MatchTier
  }

  return { score: total / tokens.length, tier: weakest }
}

/**
 * Scores one item's fields against every token of a query, for a caller that only ranks.
 * @param {ReadonlyArray<SearchField>} fields - Weighted texts the item is searched over
 * @param {ReadonlyArray<SearchToken>} tokens - Tokens the query split into
 * @returns {number | undefined} - Mean token score, or undefined when a token matched nothing
 */
export function scoreFields(
  fields: ReadonlyArray<SearchField>,
  tokens: ReadonlyArray<SearchToken>,
): number | undefined {
  return matchFields(fields, tokens)?.score
}
