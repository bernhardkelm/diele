// Decides what of a loaded page may be buffered at all. The raw url carries OAuth codes, tokens in
// fragments and search terms, so it is judged and stripped here, in memory, and only the stripped
// form ever reaches storage. The server filters everything again; what it can do and this cannot
// is resolve a name.

// Longer than any address a person opens on purpose, and past where a url is mostly payload
const HISTORY_MAX_URL = 2000

// Longer than any title a tab shows, and what the server cuts a title to anyway
const HISTORY_MAX_TITLE = 300

/**
 * Parses a loaded url, refusing anything that is not a web page or is too long to be one.
 * @param {string} raw - Url as the browser reported it
 * @returns {URL | undefined} - Parsed url, or undefined when it is not one to keep
 */
function parseHistoryUrl(raw) {
  if (typeof raw !== 'string' || raw.length > HISTORY_MAX_URL) {
    return undefined
  }

  let url

  try {
    url = new URL(raw)
  } catch {
    return undefined
  }

  return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
}

/**
 * Reads a url's host the way every comparison here makes it: lowercase, as the parser gives it,
 * and without the trailing dot that names the same host absolutely.
 * @param {URL} url - Parsed url
 * @returns {string} - The hostname, ipv6 in brackets
 */
function historyHostname(url) {
  return url.hostname.replace(/\.+$/, '')
}

/**
 * Reads a url's origin with its host in comparable form.
 * @param {URL} url - Parsed url
 * @returns {string} - Scheme, host and any port other than the default
 */
function historyOrigin(url) {
  return `${url.protocol}//${historyHostname(url)}${url.port ? `:${url.port}` : ''}`
}

/**
 * Cuts the matrix parameters off one path segment. A `;` written out ends the segment's own part
 * as the parser leaves it; an encoded one (`%3B`) is found on the segment decoded the way the
 * token check decodes it, so `/path%3Bjsessionid%3D...` loses its session as well, and what is
 * kept is encoded again.
 * @param {string} segment - One path segment, still percent-encoded
 * @returns {string} - The segment without its matrix parameters, possibly empty
 */
function stripMatrixParameters(segment) {
  const plain = segment.split(';')[0]
  const decoded = decodePathSegment(plain)
  const at = decoded.indexOf(';')

  return at < 0 ? plain : encodeURIComponent(decoded.slice(0, at))
}

/**
 * Reduces a url to origin and path, the form the server stores. The query, the fragment and the
 * credentials go, and so do matrix parameters (`;jsessionid=...`, plain or encoded), which the
 * parser leaves in the path. Empty segments are dropped, the trailing slash with them, so
 * `/docs`, `/docs/` and `/docs/;jsessionid=1` are one.
 * @param {URL} url - Parsed url
 * @returns {string} - Origin and path
 */
function stripHistoryUrl(url) {
  const segments = url.pathname
    .split('/')
    .map(stripMatrixParameters)
    .filter((segment) => segment.length > 0)

  return `${historyOrigin(url)}/${segments.join('/')}`
}

/**
 * Returns whether a host is the domain itself or one of its subdomains.
 * @param {string} hostname - Host to test, in comparable form
 * @param {string} domain - Domain as the server normalised it
 * @returns {boolean} - True when the host falls under the domain
 */
function isOnHistoryDomain(hostname, domain) {
  const bare = domain.toLowerCase().replace(/\.+$/, '')
  return bare.length > 0 && (hostname === bare || hostname.endsWith(`.${bare}`))
}

/**
 * Returns whether a stored url falls on one of the account's excluded domains, for what was
 * buffered before the exclusion arrived.
 * @param {string} stored - Url in stored form
 * @param {string[]} excludedDomains - Domains the account never records
 * @returns {boolean} - True when the url is excluded
 */
function isExcludedHistoryUrl(stored, excludedDomains) {
  const url = parseHistoryUrl(stored)
  if (!url) {
    return true
  }

  const hostname = historyHostname(url)
  return excludedDomains.some((domain) => isOnHistoryDomain(hostname, domain))
}

/**
 * Decides whether a loaded url is buffered, and in what form. A search page is judged on the url
 * as it loaded, because it is told apart by its query; the path rules run on the stripped path,
 * which is what would be sent.
 * @param {string} raw - Url as the browser reported it
 * @param {{instanceOrigins: string[], searchPatterns: object[], excludedDomains: string[]}} filter -
 *   Every configured instance's origin, the target's engines and commands as compiled patterns,
 *   and the account's excluded domains
 * @returns {string | undefined} - The url in stored form, or undefined when the visit is dropped
 */
function acceptHistoryVisit(raw, filter) {
  const url = parseHistoryUrl(raw)
  if (!url) {
    return undefined
  }

  const hostname = historyHostname(url)
  if (filter.instanceOrigins.includes(historyOrigin(url)) || isUnreachableHost(hostname)) {
    return undefined
  }

  if (filter.excludedDomains.some((domain) => isOnHistoryDomain(hostname, domain))) {
    return undefined
  }

  if (isSearchPage(url, filter.searchPatterns)) {
    return undefined
  }

  const stored = stripHistoryUrl(url)
  const path = new URL(stored).pathname

  return hasTokenSegment(path) || isCapabilityLink(path) ? undefined : stored
}

// Shorter than this, a value turns up in any title by chance and says nothing on its own
const REVEALING_MIN = 3

/**
 * Lowercases a piece of text and collapses its whitespace, the form a title and the pieces of a
 * url are compared in.
 * @param {string} text - Text to normalise
 * @returns {string} - The comparable form
 */
function comparableText(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Decodes a fragment piece once, `+` as a space, leaving what does not decode as it stands.
 * @param {string} piece - Piece of the fragment, still encoded
 * @returns {string} - The decoded piece
 */
function decodeFragmentPiece(piece) {
  try {
    return decodeURIComponent(piece.replaceAll('+', ' '))
  } catch {
    return piece
  }
}

/**
 * Returns the values of a url a title must not repeat: what its parameters carry, decoded with
 * `+` as a space, and the pieces of its fragment split on `&`, `=`, `/` and `?`. A search page
 * titles itself with the term, a single-page app with whatever its fragment routes to.
 * @param {URL} url - Parsed url
 * @returns {string[]} - Values long enough to compare, in comparable form
 */
function revealingValues(url) {
  const values = [...url.searchParams.values()]
  const fragment = url.hash
    .slice(1)
    .split(/[&=/?]/)
    .map(decodeFragmentPiece)

  return [...values, ...fragment]
    .map(comparableText)
    .filter((value) => value.length >= REVEALING_MIN)
}

// What a value has to be bounded by to count as a word of the title, not part of a longer one
const TITLE_WORD_CHAR = /[\p{L}\p{N}]/u

/**
 * Returns whether a value appears in a text as whole words: bounded on both sides by the start or
 * end of the text or by a character that is neither a letter nor a digit, in any script, so `all`
 * is found in `All of it` but not in `Install`.
 * @param {string} text - Title, in comparable form
 * @param {string} value - Value from the url, in comparable form
 * @returns {boolean} - True when the value stands on its own somewhere in the text
 */
function holdsWords(text, value) {
  for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) {
    const before = text.slice(0, at).at(-1) ?? ''
    const after = text.charAt(at + value.length)

    if (!TITLE_WORD_CHAR.test(before) && !TITLE_WORD_CHAR.test(after)) {
      return true
    }
  }

  return false
}

/**
 * Returns whether a title gives away what the stored url leaves out, or is only the address: it
 * starts with a scheme, holds the host, a leading `www.` and a trailing dot aside, or holds a
 * parameter value or fragment piece as a word. A single-label host such as `nas` is also an
 * ordinary word, and is not looked for.
 * @param {string} title - The title, already cleaned
 * @param {URL} url - The url as reported, before it is stripped
 * @returns {boolean} - True when the title should not be kept
 */
function titleLeaksHistoryUrl(title, url) {
  const text = comparableText(title)

  if (/^https?:\/\//.test(text)) {
    return true
  }

  const host = url.hostname.replace(/\.+$/, '').replace(/^www\./, '')
  if (host.includes('.') && text.includes(host)) {
    return true
  }

  return revealingValues(url).some((value) => holdsWords(text, value))
}

/**
 * Cleans a tab title for the buffer the way the server does, and drops it when it gives away what
 * the stripped url left out. Control characters become spaces and format characters (direction
 * overrides, zero-width characters) are removed, so a title cannot read as something else.
 * @param {string} raw - Url as the browser reported it
 * @param {unknown} title - Tab title, of no guaranteed shape
 * @returns {string | undefined} - The title to keep, or undefined when there is none worth it
 */
function cleanHistoryTitle(raw, title) {
  if (typeof title !== 'string') {
    return undefined
  }

  const cleaned = title
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HISTORY_MAX_TITLE)
    .trim()
  const url = parseHistoryUrl(raw)

  if (cleaned.length === 0 || !url) {
    return undefined
  }

  return titleLeaksHistoryUrl(cleaned, url) ? undefined : cleaned
}
