// Floors of the ways a token can match, spaced so the quality bonus a match earns on top of its
// floor rarely lifts it past the next one. A typo sits lowest because it is the only tier that
// matches text the token does not contain.
export const MATCH_TIERS = {
  EXACT: 800,
  PREFIX: 600,
  WORD_START: 500,
  SUBSTRING: 400,
  ACRONYM: 300,
  TYPO: 100,
} as const

export type MatchTier = (typeof MATCH_TIERS)[keyof typeof MATCH_TIERS]
