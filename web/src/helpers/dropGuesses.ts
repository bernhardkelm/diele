import { MATCH_TIERS, type MatchTier } from '@/helpers/matchTiers'

/**
 * Drops the matches that only a typo found once anything matched literally. A typo is a guess
 * at what was meant, worth offering when nothing else answers the term and noise beside a
 * literal hit, which is what kept `heise` from listing ten repos above the page it meant.
 *
 * An acronym is neither: it is kept either way, and on its own it does not set the guesses aside.
 * @param {ReadonlyArray<T>} entries - Matches, each with the tier it needed; one without a tier is kept as it is
 * @returns {ReadonlyArray<T>} - The same entries in order, without the guesses when a literal hit exists
 */
export function dropGuesses<T extends { readonly tier?: MatchTier }>(
  entries: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const literal = entries.some(
    (entry) => entry.tier !== undefined && entry.tier >= MATCH_TIERS.SUBSTRING,
  )

  return literal ? entries.filter((entry) => entry.tier !== MATCH_TIERS.TYPO) : entries
}
