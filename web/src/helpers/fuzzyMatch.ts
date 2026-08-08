/** Half-open span of matched characters in a haystack, `[start, end)`. */
export interface MatchRange {
  readonly start: number
  readonly end: number
}

export interface FuzzyMatch {
  /** 0 to 999; only comparable between matches of the same token */
  readonly score: number
  /** Where the token landed, ascending and non-overlapping */
  readonly ranges: ReadonlyArray<MatchRange>
}

// Shorter tokens only ever match contiguously: letting `r` or `lh` scatter across a name
// would match nearly everything, which is worse than not matching at all. Landing every
// character on a word start is specific enough to stay useful two characters down, which is
// what makes `uk` find `Uptime Kuma`.
const MIN_SUBSEQUENCE_LENGTH = 3
const MIN_ACRONYM_LENGTH = 2

// Tier floors, spaced wider than the quality bonus so no tier can be lifted past the next.
const EXACT = 800
const PREFIX = 600
const WORD_START = 500
const SUBSTRING = 400
const ACRONYM = 300
const SUBSEQUENCE = 100

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
 * Finds the positions a token occupies in a haystack as a subsequence, tightest last.
 * @param {string} haystack - Lowercased text to search
 * @param {string} needle - Lowercased token to place
 * @returns {number[] | undefined} - Ascending positions, or undefined when the token does not fit
 */
function subsequencePositions(haystack: string, needle: string): number[] | undefined {
  let end = -1
  let ahead = 0

  for (let index = 0; index < haystack.length && ahead < needle.length; index += 1) {
    if (haystack[index] === needle[ahead]) {
      end = index
      ahead += 1
    }
  }

  if (ahead < needle.length) {
    return undefined
  }

  // walking back from the earliest possible end gives the tightest window, which a forward
  // pass alone misses whenever an early character of the token repeats
  const positions: number[] = []
  let behind = needle.length - 1

  for (let index = end; index >= 0 && behind >= 0; index -= 1) {
    if (haystack[index] === needle[behind]) {
      positions.unshift(index)
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
 * Matches one token against one text, softly. A literal hit scores highest and is ranked by
 * where it sits, a token whose characters merely appear in order still matches but lands far
 * below, so `prometeus` finds `prometheus` without `abc` finding half the portal.
 * @param {string} text - Text to search, in its original casing
 * @param {string} token - Lowercased token to look for
 * @returns {FuzzyMatch | undefined} - Score and matched spans, or undefined when it does not match
 */
export function fuzzyMatch(text: string, token: string): FuzzyMatch | undefined {
  if (!text || !token) {
    return undefined
  }

  const haystack = text.toLowerCase()
  const at = haystack.indexOf(token)

  if (at !== -1) {
    const contiguous =
      at === 0
        ? token.length === haystack.length
          ? EXACT
          : PREFIX
        : isWordStart(text, at)
          ? WORD_START
          : SUBSTRING

    return {
      score: contiguous + quality(token.length, token.length, haystack.length),
      ranges: [{ start: at, end: at + token.length }],
    }
  }

  if (token.length < MIN_ACRONYM_LENGTH) {
    return undefined
  }

  const positions = subsequencePositions(haystack, token)
  if (!positions) {
    return undefined
  }

  const acronym = positions.every((position) => isWordStart(text, position))
  if (!acronym && token.length < MIN_SUBSEQUENCE_LENGTH) {
    return undefined
  }

  const span = positions[positions.length - 1]! - positions[0]! + 1

  return {
    score: (acronym ? ACRONYM : SUBSEQUENCE) + quality(token.length, span, haystack.length),
    ranges: toRanges(positions),
  }
}
