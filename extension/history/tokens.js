// The server's two path rules, token-like segments and capability links, kept to the same
// thresholds so a url the extension buffers is one the server would keep. Both exist because a
// key in a path is a working key in a list the search offers back.

// Shorter than this, a segment is taken for an id or a word.
const TOKEN_MIN_SEGMENT = 20

// A part this long with this much mixing of letters and digits reads as random
const TOKEN_MIN_PART = 16
const TOKEN_MIN_TRANSITIONS = 3

// Below this share of vowels, a long run of letters is not a word in any language
const TOKEN_MIN_VOWEL_SHARE = 0.2

// Page ids Confluence and Notion hand out, often appended to a slug, cut out before what is left
// of the segment is judged
const TOKEN_PAGE_ID =
  /(^|[-_.~+])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})(?=$|[-_.~+])/gi

const TOKEN_SEPARATORS = /[-_.~+,=:;!*' ]+/

// Words that introduce a link which is itself the key: what follows one is an id that grants
// access, however short or tidy it looks
const CAPABILITY_KEYWORDS = new Set([
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

const CAPABILITY_WORD_SEPARATORS = /[-_.]/

// Shorter than this, a part of what follows a keyword is a word, a route or a short id such as a
// user's number, not a key
const CAPABILITY_MIN_OPAQUE = 10

// Ids that are a key after a keyword however they are written: a UUID, a 32-hex page id or a hash
// of 40 hex digits or more
const CAPABILITY_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[0-9a-f]{40,})$/i

// Keywords this short only count as a whole segment: as a part of a slug, a single letter is an
// ordinary fragment of English (`what-s-new`), not a share route
const CAPABILITY_MIN_KEYWORD_PART = 2

// Below this, a run of letters is too short to judge by its vowels: `ts`, `of`, `api`
const SLUG_SHORT_WORD = 4

// Longer than a year, a version or an issue number, a run of digits reads as an id
const SLUG_MAX_NUMBER = 8

/**
 * Percent-decodes a segment up to twice, so a value encoded a second time to slip past a filter
 * is judged on what it stands for. Anything that does not decode is judged as it stands.
 * @param {string} segment - One path segment, still percent-encoded
 * @returns {string} - The decoded segment
 */
function decodePathSegment(segment) {
  let value = segment

  for (let round = 0; round < 2; round += 1) {
    let next

    try {
      next = decodeURIComponent(value)
    } catch {
      break
    }

    if (next === value) {
      break
    }

    value = next
  }

  return value
}

/**
 * Counts how often a part switches between letters and digits. A slug switches once or twice, a
 * random token every few characters.
 * @param {string} part - Text between separators
 * @returns {number} - Number of letter and digit boundaries
 */
function letterDigitTransitions(part) {
  let count = 0
  let previous

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
 * Returns whether a run of letters carries too few vowels to be a word.
 * @param {string} part - Letters only
 * @returns {boolean} - True when it reads as random letters
 */
function isUnpronounceable(part) {
  const vowels = part.match(/[aeiouäöü]/giu)?.length ?? 0
  return vowels / part.length < TOKEN_MIN_VOWEL_SHARE
}

/**
 * Returns whether one part of a segment is random rather than written.
 * @param {string} part - Text between separators
 * @returns {boolean} - True when it reads as a token
 */
function isRandomPart(part) {
  if (part.length < TOKEN_MIN_PART) {
    return false
  }

  if (letterDigitTransitions(part) >= TOKEN_MIN_TRANSITIONS) {
    return true
  }

  return part.length >= TOKEN_MIN_SEGMENT && /^\p{L}+$/u.test(part) && isUnpronounceable(part)
}

/**
 * Returns whether a path segment looks like a secret: long, random and not made of words, the
 * way reset links, magic sign-in links and signed share links carry theirs.
 * @param {string} segment - One path segment, still percent-encoded
 * @returns {boolean} - True when the segment reads as a token
 */
function isTokenSegment(segment) {
  const decoded = decodePathSegment(segment)

  if (decoded.length < TOKEN_MIN_SEGMENT) {
    return false
  }

  return decoded.replace(TOKEN_PAGE_ID, '$1').split(TOKEN_SEPARATORS).some(isRandomPart)
}

/**
 * Returns whether any segment of a path looks like a secret.
 * @param {string} pathname - Path, still percent-encoded
 * @returns {boolean} - True when one segment reads as a token
 */
function hasTokenSegment(pathname) {
  return pathname.split('/').some(isTokenSegment)
}

/**
 * Returns whether one word of a slug reads as written: a number no longer than a year or a
 * version, or letters with an optional number after them (`oauth2`, `v2`) that are either short
 * or carry enough vowels.
 * @param {string} word - One word, between separators and camelCase boundaries
 * @param {boolean} camel - Whether it came from a camelCase run, where words need three letters
 * @returns {boolean} - True when it reads as a word
 */
function isWrittenWord(word, camel) {
  if (/^\d+$/.test(word)) {
    return word.length <= SLUG_MAX_NUMBER
  }

  const letters = /^([a-z]+)\d*$/i.exec(word)?.[1]
  if (!letters || (camel && letters.length < 3)) {
    return false
  }

  return letters.length < SLUG_SHORT_WORD || !isUnpronounceable(letters)
}

/**
 * Returns whether one part of a slug, between `-`, `_` and `.`, reads as written: a written word
 * or a run of camelCase words, such as `oauth2`, `release` or `oauth2Client`. A run like
 * `AbCdEf1234` splits into words too short to be any.
 * @param {string} part - Text between separators
 * @returns {boolean} - True when the part reads as written
 */
function isSlugPart(part) {
  const words = part.split(/(?<=[a-z\d])(?=[A-Z])/)

  return words.every((word) => isWrittenWord(word, words.length > 1))
}

/**
 * Returns whether a segment after a keyword is the key itself: url-safe token characters only,
 * and token-like by the entropy rule, a UUID or hex id, or holding a part of ten characters or
 * more that is not written. A short id such as a user's number or Django's `MQ` is not, and
 * neither is a slug, so `oauth2-setup-guide` and `release-2024` are kept.
 * @param {string} segment - One path segment, decoded
 * @returns {boolean} - True when it reads as a key
 */
function isCapabilityId(segment) {
  if (!/^[\w.~=+-]+$/.test(segment)) {
    return false
  }

  if (CAPABILITY_ID.test(segment) || isTokenSegment(segment)) {
    return true
  }

  return segment
    .split(CAPABILITY_WORD_SEPARATORS)
    .some((part) => part.length >= CAPABILITY_MIN_OPAQUE && !isSlugPart(part))
}

/**
 * Returns whether a segment is, or holds as one of its words, a capability keyword. A keyword
 * shorter than two letters counts only as the whole segment.
 * @param {string} segment - One path segment, decoded
 * @returns {boolean} - True when it introduces a capability link
 */
function isCapabilityKeyword(segment) {
  const lower = segment.toLowerCase()

  if (CAPABILITY_KEYWORDS.has(lower)) {
    return true
  }

  return lower
    .split(CAPABILITY_WORD_SEPARATORS)
    .some((part) => part.length >= CAPABILITY_MIN_KEYWORD_PART && CAPABILITY_KEYWORDS.has(part))
}

/**
 * Returns whether a path is a capability link: a key in any segment after one holding a keyword,
 * since a short id can stand between them, as in Django's `/reset/MQ/<token>/` or
 * `/email/verify/42/<hash>`. Only a key counts there, so a repository path or a docs page below
 * an `auth` segment, all slugs and file names, is kept. An encoded slash is a boundary like any
 * other, since it is one to whatever routes the request.
 * @param {string} pathname - Path, matrix parameters already removed
 * @returns {boolean} - True when the path carries a key behind a keyword
 */
function isCapabilityLink(pathname) {
  const segments = pathname
    .split('/')
    .flatMap((segment) => decodePathSegment(segment).split(/\/|%2f/i))
  const at = segments.findIndex(isCapabilityKeyword)

  return at >= 0 && segments.slice(at + 1).some(isCapabilityId)
}
