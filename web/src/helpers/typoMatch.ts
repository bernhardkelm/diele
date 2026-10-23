import { editDistance } from '@/helpers/editDistance'
import { wordSpans } from '@/helpers/wordSpans'

// Below four characters a single edit already turns one word into another (`cat`, `car`, `can`),
// so a short token has to be typed right. From eight on, two slips are as likely as one was.
const MIN_TYPO_LENGTH = 4
const TWO_EDIT_LENGTH = 8

/** Where a token landed as a typo, `[start, end)`, and how many edits it took. */
export interface TypoMatch {
  readonly start: number
  readonly end: number
  readonly edits: number
}

/**
 * Returns how many edits a token of a length may be away from a word and still match it.
 * @param {number} length - Length of the token
 * @returns {number} - Edits allowed, 0 for a token too short to guess at
 */
export function allowedEdits(length: number): number {
  if (length < MIN_TYPO_LENGTH) {
    return 0
  }

  return length < TWO_EDIT_LENGTH ? 1 : 2
}

/**
 * Returns how close a token comes to one word: to the whole of it, or to its start of the same
 * length, which is what a word still being typed looks like.
 * @param {string} word - Lowercased word
 * @param {string} needle - Lowercased token
 * @param {number} max - Edits allowed
 * @returns {{ edits: number; length: number } | undefined} - Edits and how much of the word they cover, or undefined when too far
 */
function closestReading(
  word: string,
  needle: string,
  max: number,
): { edits: number; length: number } | undefined {
  const whole = editDistance(word, needle, max)
  if (whole !== undefined) {
    return { edits: whole, length: word.length }
  }

  if (word.length <= needle.length) {
    return undefined
  }

  const prefix = editDistance(word.slice(0, needle.length), needle, max)

  return prefix === undefined ? undefined : { edits: prefix, length: needle.length }
}

/**
 * Finds the word of a text a token reads as with a slip of the keyboard, so `prometeus` finds
 * `Prometheus` and `grafna` finds `Grafana`. Only whole words are compared, never letters
 * scattered across the text, which is what keeps a five letter token from matching a repo just
 * because its letters appear somewhere in order.
 * @param {string} text - Text to search, in its original casing
 * @param {string} needle - Lowercased token
 * @returns {TypoMatch | undefined} - Closest word, fewest edits then earliest, or undefined
 */
export function typoMatch(text: string, needle: string): TypoMatch | undefined {
  const max = allowedEdits(needle.length)
  if (max === 0) {
    return undefined
  }

  // lowercased once rather than per word, unless casing changes the length and so the positions
  const lower = text.toLowerCase()
  const aligned = lower.length === text.length
  let best: TypoMatch | undefined

  for (const span of wordSpans(text)) {
    const word = aligned
      ? lower.slice(span.start, span.end)
      : text.slice(span.start, span.end).toLowerCase()
    const reading = closestReading(word, needle, max)

    if (reading && (!best || reading.edits < best.edits)) {
      best = { start: span.start, end: span.start + reading.length, edits: reading.edits }
    }
  }

  return best
}
