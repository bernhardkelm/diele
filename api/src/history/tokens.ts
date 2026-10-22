// Shorter than this, a segment is taken for an id or a word. A short secret outside the links
// `capabilityLinks.ts` recognises gets through, which is the accepted cost of keeping page ids.
const MIN_SEGMENT = 20

/** A part this long with this much mixing of letters and digits reads as random. */
const MIN_PART = 16
const MIN_TRANSITIONS = 3

/** Below this share of vowels, a long run of letters is not a word in any language. */
const MIN_VOWEL_SHARE = 0.2

// Page ids Confluence and Notion hand out, often appended to a slug, so they are cut out before
// what is left of the segment is judged.
const PAGE_ID =
  /(^|[-_.~+])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})(?=$|[-_.~+])/gi

const SEPARATORS = /[-_.~+,=:;!*' ]+/

/**
 * Counts how often a part switches between letters and digits. A slug switches once or twice, at
 * a version or a year; a random token switches every few characters.
 * @param {string} part - Text between separators
 * @returns {number} - Number of letter and digit boundaries
 */
function transitions(part: string): number {
  let count = 0
  let previous: 'letter' | 'digit' | undefined

  for (const char of part) {
    const kind = /\d/.test(char) ? 'digit' : /\p{L}/u.test(char) ? 'letter' : undefined

    if (kind && previous && kind !== previous) {
      count += 1
    }

    previous = kind ?? previous
  }

  return count
}

/**
 * Percent-decodes a segment up to twice, so a value encoded a second time to slip past a filter
 * is judged on what it stands for. Anything that does not decode is judged as it stands.
 * @param {string} segment - One path segment, still percent-encoded
 * @returns {string} - The decoded segment
 */
export function decodeSegment(segment: string): string {
  let value = segment

  for (let round = 0; round < 2; round += 1) {
    try {
      const next = decodeURIComponent(value)
      if (next === value) {
        break
      }

      value = next
    } catch {
      break
    }
  }

  return value
}

/**
 * Returns whether a run of letters carries too few vowels to be a word.
 * @param {string} part - Text between separators, letters only
 * @returns {boolean} - True when it reads as random letters
 */
export function isUnpronounceable(part: string): boolean {
  const vowels = part.match(/[aeiouäöü]/giu)?.length ?? 0

  return vowels / part.length < MIN_VOWEL_SHARE
}

/**
 * Returns whether one part of a segment is random rather than written.
 * @param {string} part - Text between separators
 * @returns {boolean} - True when it reads as a token
 */
function isRandomPart(part: string): boolean {
  if (part.length < MIN_PART) {
    return false
  }

  if (transitions(part) >= MIN_TRANSITIONS) {
    return true
  }

  return part.length >= MIN_SEGMENT && /^\p{L}+$/u.test(part) && isUnpronounceable(part)
}

/**
 * Returns whether a path segment looks like a secret: long, random and not made of words, the
 * way password-reset links, magic sign-in links and signed share links carry theirs. Storing such
 * a url would keep the key to an account in a list offered back in a search field.
 * @param {string} segment - One path segment, still percent-encoded
 * @returns {boolean} - True when the segment reads as a token
 */
export function isTokenSegment(segment: string): boolean {
  const decoded = decodeSegment(segment)

  if (decoded.length < MIN_SEGMENT) {
    return false
  }

  const rest = decoded.replace(PAGE_ID, '$1')

  return rest.split(SEPARATORS).some(isRandomPart)
}

/**
 * Returns whether any segment of a path looks like a secret.
 * @param {string} pathname - Path as the URL parser gives it
 * @returns {boolean} - True when one segment reads as a token
 */
export function hasTokenSegment(pathname: string): boolean {
  return pathname.split('/').some(isTokenSegment)
}
