import { decodeSegment, isUnpronounceable } from './tokens.js'

/**
 * Words that introduce a link which is itself the key: a reset, an invitation, a share, a
 * confirmation. Matched against the parts of a segment too, so `reset-password` and `magic-link`
 * count. What follows one is an id that grants access, however short or tidy it looks.
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

/** Shorter than this, what follows a keyword is a word or a route, not a key. */
const MIN_OPAQUE = 10

/**
 * Returns whether a segment is an opaque id rather than a word or a slug: only url-safe token
 * characters, and carrying a digit, a lowercase letter followed by a capital, or too few vowels.
 * UUIDs and hex page ids count here, unlike in the general token check.
 * @param {string} segment - One path segment, decoded
 * @returns {boolean} - True when it reads as an id
 */
function isOpaque(segment: string): boolean {
  if (segment.length < MIN_OPAQUE || !/^[\w.~=+-]+$/.test(segment)) {
    return false
  }

  if (/\d/.test(segment) || /[a-z][A-Z]/.test(segment)) {
    return true
  }

  const letters = segment.replace(/[^a-z]/gi, '')

  return letters.length >= MIN_OPAQUE && isUnpronounceable(letters)
}

/**
 * Returns whether a segment is, or holds as one of its words, a capability keyword.
 * @param {string} segment - One path segment, decoded
 * @returns {boolean} - True when it introduces a capability link
 */
function isKeyword(segment: string): boolean {
  return segment
    .toLowerCase()
    .split(WORD_SEPARATORS)
    .some((part) => KEYWORDS.has(part))
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
 * Returns whether a path is a capability link: after a segment holding one of the keywords, any
 * later segment is an opaque id. Storing such a link would keep a working key in a list the
 * search offers back. A docs page or a post about the same thing, such as `/docs/login-flow`,
 * has no id after the keyword and is kept.
 * @param {string} pathname - Path, matrix parameters already removed
 * @returns {boolean} - True when the path carries a key behind a keyword
 */
export function isCapabilityLink(pathname: string): boolean {
  const segments = segmentsOf(pathname)
  const at = segments.findIndex(isKeyword)

  return at >= 0 && segments.slice(at + 1).some(isOpaque)
}
