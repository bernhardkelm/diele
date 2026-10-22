import { matchAsTyped, matchAsTypo } from '@/helpers/fuzzyMatch'
import { MATCH_TIERS, type MatchTier } from '@/helpers/matchTiers'
import type { SearchField } from '@/helpers/searchFields'
import type { SearchToken } from '@/helpers/searchTokens'
import { allowedEdits } from '@/helpers/typoMatch'

/** How well an item's fields answered a query. */
export interface FieldsMatch {
  /** Mean of each token's best weighted field score, never zero */
  readonly score: number
  /** Weakest tier any token needed, so a single guessed token marks the whole item a guess */
  readonly tier: MatchTier
}

/** How the tokens fared against one item's fields as typed, before any typo was tried. */
export interface TypedPass {
  /** Best weighted score and tier per token, up to and including the first one that hit nothing */
  readonly tokens: ReadonlyArray<TokenBest>
  /** Weakest tier across the tokens, undefined unless every one of them hit */
  readonly tier: MatchTier | undefined
}

interface TokenBest {
  /** 0 where the token hit nothing */
  readonly score: number
  readonly tier: MatchTier | undefined
}

/**
 * Returns a token's best weighted score and tier over the fields, as typed.
 * @param {ReadonlyArray<SearchField>} fields - Weighted texts the item is searched over
 * @param {SearchToken} token - Token to look for
 * @returns {TokenBest} - Its best score, 0 when it hit nothing, and its best tier
 */
function bestAsTyped(fields: ReadonlyArray<SearchField>, token: SearchToken): TokenBest {
  let score = 0
  let tier: MatchTier | undefined

  for (const field of fields) {
    const match = matchAsTyped(field.text, token)
    if (match) {
      score = Math.max(score, match.score * field.weight)
      tier = tier === undefined ? match.tier : (Math.max(tier, match.tier) as MatchTier)
    }
  }

  return { score, tier }
}

/**
 * Matches one item's fields against the tokens as typed, literally or by initials, leaving the
 * typos for later: they cost the most and are thrown away wherever anything matched as typed.
 * It stops at the first token that hits nothing, since only a typo could still find the item.
 * @param {ReadonlyArray<SearchField>} fields - Weighted texts the item is searched over
 * @param {ReadonlyArray<SearchToken>} tokens - Tokens the query split into
 * @returns {TypedPass} - Each token's best as far as it got, and the item's tier when all of them hit
 */
export function matchTyped(
  fields: ReadonlyArray<SearchField>,
  tokens: ReadonlyArray<SearchToken>,
): TypedPass {
  const found: TokenBest[] = []
  let weakest: MatchTier = MATCH_TIERS.EXACT

  for (const token of tokens) {
    const best = bestAsTyped(fields, token)
    found.push(best)

    if (best.tier === undefined || best.score === 0) {
      return { tokens: found, tier: undefined }
    }

    weakest = Math.min(weakest, best.tier) as MatchTier
  }

  return { tokens: found, tier: tokens.length > 0 ? weakest : undefined }
}

/**
 * Finishes a match begun as typed by trying the typos, though only on a field where one could
 * still raise a token's best: a typo scores under the acronym floor, so a field whose weight puts
 * even that floor at or below the best so far is skipped, and so is every field a token already
 * hit as typed, which always scores at least that floor.
 * @param {ReadonlyArray<SearchField>} fields - Weighted texts the item is searched over
 * @param {ReadonlyArray<SearchToken>} tokens - Tokens the query split into
 * @param {TypedPass} typed - What `matchTyped` found for the same fields and tokens
 * @returns {FieldsMatch | undefined} - Score and tier, or undefined when a token matched nothing
 */
export function completeMatch(
  fields: ReadonlyArray<SearchField>,
  tokens: ReadonlyArray<SearchToken>,
  typed: TypedPass,
): FieldsMatch | undefined {
  if (tokens.length === 0) {
    return undefined
  }

  let total = 0
  let weakest: MatchTier = MATCH_TIERS.EXACT

  for (const [index, token] of tokens.entries()) {
    const asTyped = typed.tokens[index] ?? bestAsTyped(fields, token)
    let best = asTyped.score
    let tier = asTyped.tier
    const guessable = !token.exact && allowedEdits(token.text.length) > 0

    for (const field of guessable ? fields : []) {
      if (MATCH_TIERS.ACRONYM * field.weight <= best) {
        continue
      }

      const match = matchAsTypo(field.text, token)
      if (match) {
        best = Math.max(best, match.score * field.weight)
        tier ??= match.tier
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
  return completeMatch(fields, tokens, matchTyped(fields, tokens))
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
