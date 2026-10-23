import { MATCH_TIERS, type MatchTier } from '@/helpers/matchTiers'
import type { SearchToken } from '@/helpers/searchTokens'
import { typoMatch } from '@/helpers/typoMatch'

/** Half-open span of matched characters in a haystack, `[start, end)`. */
export interface MatchRange {
  readonly start: number
  readonly end: number
}

export interface FuzzyMatch {
  /** 0 to 999; only comparable between matches of the same token */
  readonly score: number
  /** Floor of the way it matched, which is what tells a literal hit from a guess */
  readonly tier: MatchTier
  /** Where the token landed, ascending and non-overlapping */
  readonly ranges: ReadonlyArray<MatchRange>
}

// Landing every character on a word start is specific enough to stay useful two characters down,
// which is what makes `uk` find `Uptime Kuma`.
const MIN_ACRONYM_LENGTH = 2

// taken off a typo's bonus per edit, so one slip on a word outranks two on the same word
const TYPO_EDIT_COST = 50

const WORD_CHAR = /[a-z0-9]/i

/**
 * Returns whether a position opens a word, counting both separators and camel humps.
 * @param {string} text - Haystack in its original casing, which is what carries the humps
 * @param {number} index - Position to test
 * @returns {boolean} - True at the start of the text, after a separator or on a camel hump
 */
function isWordStart(text: string, index: number): boolean {
  if (index === 0) {
    return true
  }

  const previous = text[index - 1] ?? ''
  if (!WORD_CHAR.test(previous)) {
    return true
  }

  const current = text[index] ?? ''
  return previous === previous.toLowerCase() && current !== current.toLowerCase()
}

/**
 * Returns the bonus that separates two matches inside the same tier: how much of the
 * haystack the token covers, and how tightly its characters sit together.
 * @param {number} matched - Characters the token matched
 * @param {number} span - Distance from the first matched character to the last
 * @param {number} length - Length of the haystack
 * @returns {number} - Bonus from 0 to 199
 */
function quality(matched: number, span: number, length: number): number {
  const coverage = length > 0 ? matched / length : 0
  const density = span > 0 ? matched / span : 0
  return Math.round(150 * coverage + 49 * density)
}

/**
 * Finds the word starts a token's characters land on, in order, choosing the tightest run when
 * a letter opens more than one word.
 * @param {string} text - Haystack in its original casing, which is what carries the humps
 * @param {string} haystack - The same text, lowercased
 * @param {string} needle - Lowercased token to place
 * @returns {number[] | undefined} - Ascending positions, or undefined when the token does not fit
 */
function acronymPositions(text: string, haystack: string, needle: string): number[] | undefined {
  const starts: number[] = []
  for (let index = 0; index < haystack.length; index += 1) {
    if (WORD_CHAR.test(haystack[index]!) && isWordStart(text, index)) {
      starts.push(index)
    }
  }

  let end = -1
  let ahead = 0

  for (let slot = 0; slot < starts.length && ahead < needle.length; slot += 1) {
    if (haystack[starts[slot]!] === needle[ahead]) {
      end = slot
      ahead += 1
    }
  }

  if (ahead < needle.length) {
    return undefined
  }

  // walking back from the earliest possible end gives the tightest window, which a forward
  // pass alone misses whenever an early letter of the token opens several words
  const positions: number[] = []
  let behind = needle.length - 1

  for (let slot = end; slot >= 0 && behind >= 0; slot -= 1) {
    if (haystack[starts[slot]!] === needle[behind]) {
      positions.unshift(starts[slot]!)
      behind -= 1
    }
  }

  return positions
}

/**
 * Folds matched positions into the contiguous runs a renderer can mark up.
 * @param {ReadonlyArray<number>} positions - Ascending matched positions
 * @returns {MatchRange[]} - One range per run
 */
function toRanges(positions: ReadonlyArray<number>): MatchRange[] {
  const ranges: MatchRange[] = []

  for (const position of positions) {
    const last = ranges.at(-1)
    if (last && last.end === position) {
      ranges[ranges.length - 1] = { start: last.start, end: position + 1 }
    } else {
      ranges.push({ start: position, end: position + 1 })
    }
  }

  return ranges
}

/**
 * Matches a token where it appears literally, ranked by where it sits.
 * @param {string} text - Text to search, in its original casing
 * @param {string} haystack - The same text, lowercased
 * @param {string} needle - Lowercased token
 * @returns {FuzzyMatch | undefined} - The match, or undefined when the token is not in the text
 */
function literalMatch(text: string, haystack: string, needle: string): FuzzyMatch | undefined {
  const at = haystack.indexOf(needle)
  if (at === -1) {
    return undefined
  }

  const tier =
    at === 0
      ? needle.length === haystack.length
        ? MATCH_TIERS.EXACT
        : MATCH_TIERS.PREFIX
      : isWordStart(text, at)
        ? MATCH_TIERS.WORD_START
        : MATCH_TIERS.SUBSTRING

  return {
    score: tier + quality(needle.length, needle.length, haystack.length),
    tier,
    ranges: [{ start: at, end: at + needle.length }],
  }
}

/**
 * Matches a token whose every character lands on the start of a word, in order.
 * @param {string} text - Text to search, in its original casing
 * @param {string} haystack - The same text, lowercased
 * @param {string} needle - Lowercased token
 * @returns {FuzzyMatch | undefined} - The match, or undefined when the token is no acronym of the text
 */
function acronymMatch(text: string, haystack: string, needle: string): FuzzyMatch | undefined {
  const positions = acronymPositions(text, haystack, needle)
  if (!positions) {
    return undefined
  }

  const span = positions[positions.length - 1]! - positions[0]! + 1

  return {
    score: MATCH_TIERS.ACRONYM + quality(needle.length, span, haystack.length),
    tier: MATCH_TIERS.ACRONYM,
    ranges: toRanges(positions),
  }
}

/**
 * Matches one token against one text by everything short of a typo: literally, ranked by where
 * it sits, or by the initials of the text's words. A quoted token is only ever read literally,
 * since asking for one is asking for the guessing to stop.
 * @param {string} text - Text to search, in its original casing
 * @param {SearchToken} token - Token to look for, and whether it was quoted
 * @returns {FuzzyMatch | undefined} - Score, tier and matched spans, or undefined when it does not match
 */
export function matchAsTyped(text: string, token: SearchToken): FuzzyMatch | undefined {
  const needle = token.text
  if (!text || !needle) {
    return undefined
  }

  const haystack = text.toLowerCase()
  const literal = literalMatch(text, haystack, needle)

  // past a literal hit everything is a guess at what was meant, which a quoted token refuses
  if (literal || token.exact || needle.length < MIN_ACRONYM_LENGTH) {
    return literal
  }

  return acronymMatch(text, haystack, needle)
}

/**
 * Matches a token that is a word of the text, or the start of one, typed with a slip. It never
 * scores 300 or more, under every match `matchAsTyped` finds, which is what lets a caller skip it
 * wherever a hit as typed already scores higher.
 * @param {string} text - Text to search, in its original casing
 * @param {SearchToken} token - Token to look for, and whether it was quoted
 * @returns {FuzzyMatch | undefined} - The match, marking the word, or undefined when no word is close
 */
export function matchAsTypo(text: string, token: SearchToken): FuzzyMatch | undefined {
  if (!text || token.exact) {
    return undefined
  }

  const typo = typoMatch(text, token.text)
  if (!typo) {
    return undefined
  }

  const length = typo.end - typo.start
  const bonus = quality(length, length, text.length) - TYPO_EDIT_COST * typo.edits

  return {
    score: MATCH_TIERS.TYPO + Math.max(0, bonus),
    tier: MATCH_TIERS.TYPO,
    ranges: [{ start: typo.start, end: typo.end }],
  }
}

/**
 * Matches one token against one text, softly. A literal hit scores highest and is ranked by
 * where it sits, the initials of the text's words come next, and a token one or two edits away
 * from one of its words still matches but lands below everything else, so `prometeus` finds
 * `prometheus` without `heise` finding every repo that happens to hold those letters in order.
 * @param {string} text - Text to search, in its original casing
 * @param {SearchToken} token - Token to look for, and whether it was quoted
 * @returns {FuzzyMatch | undefined} - Score, tier and matched spans, or undefined when it does not match
 */
export function fuzzyMatch(text: string, token: SearchToken): FuzzyMatch | undefined {
  return matchAsTyped(text, token) ?? matchAsTypo(text, token)
}
