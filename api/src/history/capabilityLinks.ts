import { decodeSegment, isUnpronounceable } from './tokens.js'

/**
 * Words that introduce a link which is itself the key: a reset, an invitation, a share, a
 * confirmation. Matched against the parts of a segment too, so `reset-password` and `magic-link`
 * count. The segment right after one is an id that grants access, however short it is, unless it
 * reads as a slug.
 */
const KEYWORDS: ReadonlySet<string> = new Set([
  'reset',
  'password',
  'invite',
  'invites',
  'invitation',
  'invitations',
  'join',
  'claim',
  'accept',
  'approve',
  'login',
  'signin',
  's',
  'share',
  'shared',
  'verify',
  'email',
  'confirm',
  'activate',
  'magic',
  'unsubscribe',
  'download',
  'webhook',
  'webhooks',
  'token',
  'auth',
])

/** What a segment is split on to find a keyword inside a slug. */
const WORD_SEPARATORS = /[-_.]/

/**
 * Keywords this short only count as a whole segment. As a part of a slug, a single letter is an
 * ordinary fragment of English (`what-s-new`), not a share route.
 */
const MIN_KEYWORD_PART = 2

/** Below this, a run of letters is too short to judge by its vowels: `ts`, `of`, `api`. */
const SHORT_WORD = 4

/** Longer than a year, a version or an issue number, a run of digits reads as an id. */
const MAX_NUMBER = 8

/** Shorter than this, what follows a keyword is a word or a route, not a key. */
const MIN_OPAQUE = 10

/**
 * Returns whether one word of a slug reads as written: a number no longer than a year or a
 * version, or letters with an optional number after them (`oauth2`, `v2`) that are either short
 * or carry enough vowels.
 * @param {string} word - One word, between separators and camelCase boundaries
 * @param {boolean} camel - Whether it came out of a camelCase run, where a word is three letters at least
 * @returns {boolean} - True when it reads as a word
 */
function isWrittenWord(word: string, camel: boolean): boolean {
  if (/^\d+$/.test(word)) {
    return word.length <= MAX_NUMBER
  }

  const letters = /^([a-z]+)\d*$/i.exec(word)?.[1]
  if (!letters || (camel && letters.length < 3)) {
    return false
  }

  return letters.length < SHORT_WORD || !isUnpronounceable(letters)
}

/**
 * Returns whether a segment reads as a slug: words joined by `-`, `_` or `.`, each of them a
 * written word or a run of camelCase words, such as `oauth2-setup-guide`, `release-2024` or
 * `oauth2Client.ts`. A run like `AbCdEf1234` splits into words too short to be any.
 * @param {string} segment - One path segment, decoded
 * @returns {boolean} - True when every part reads as written
 */
function isSlug(segment: string): boolean {
  const parts = segment.split(WORD_SEPARATORS).filter((part) => part.length > 0)

  return (
    parts.length > 0 &&
    parts.every((part) => {
      const words = part.split(/(?<=[a-z\d])(?=[A-Z])/)

      return words.every((word) => isWrittenWord(word, words.length > 1))
    })
  )
}

/**
 * Returns whether a segment is an opaque id rather than a word or a slug: only url-safe token
 * characters, carrying a digit, a lowercase letter followed by a capital, or too few vowels, and
 * not made of written words. UUIDs and hex page ids count here, unlike in the general token check.
 * @param {string} segment - One path segment, decoded
 * @returns {boolean} - True when it reads as an id
 */
function isOpaque(segment: string): boolean {
  if (segment.length < MIN_OPAQUE || !/^[\w.~=+-]+$/.test(segment) || isSlug(segment)) {
    return false
  }

  if (/\d/.test(segment) || /[a-z][A-Z]/.test(segment)) {
    return true
  }

  const letters = segment.replace(/[^a-z]/gi, '')

  return letters.length >= MIN_OPAQUE && isUnpronounceable(letters)
}

/**
 * Returns whether a segment is, or holds as one of its words, a capability keyword. A keyword
 * shorter than two letters counts only as the whole segment.
 * @param {string} segment - One path segment, decoded
 * @returns {boolean} - True when it introduces a capability link
 */
function isKeyword(segment: string): boolean {
  const lower = segment.toLowerCase()
  if (KEYWORDS.has(lower)) {
    return true
  }

  return lower
    .split(WORD_SEPARATORS)
    .some((part) => part.length >= MIN_KEYWORD_PART && KEYWORDS.has(part))
}

/**
 * Splits a path into decoded segments. An encoded slash inside a segment is a boundary like any
 * other, so `reset%2F<id>` is judged as `reset` followed by the id.
 * @param {string} pathname - Path, still percent-encoded
 * @returns {string[]} - Decoded segments
 */
function segmentsOf(pathname: string): string[] {
  return pathname.split('/').flatMap((segment) => decodeSegment(segment).split(/\/|%2f/i))
}

/**
 * Returns whether a path is a capability link: a segment holding one of the keywords, followed
 * directly by an opaque id. Storing such a link would keep a working key in a list the search
 * offers back. Only that next segment is judged, so a repository named `auth-service` does not
 * take every file in it along, and a docs page or a post about the same thing, such as
 * `/docs/login-flow` or `/auth/oauth2-setup-guide`, is kept.
 * @param {string} pathname - Path, matrix parameters already removed
 * @returns {boolean} - True when the path carries a key behind a keyword
 */
export function isCapabilityLink(pathname: string): boolean {
  const segments = segmentsOf(pathname)

  return segments.some((segment, at) => {
    const next = segments[at + 1]

    return next !== undefined && isKeyword(segment) && isOpaque(next)
  })
}
