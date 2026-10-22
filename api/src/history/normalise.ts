/** Longer than any address a person opens on purpose, and past where a url is mostly payload. */
export const MAX_URL_LENGTH = 2000

/**
 * Parses a url a source reported, refusing anything that is not a web page or is too long to be
 * one a person typed or clicked.
 * @param {string} raw - Url as the source saw it
 * @returns {URL | undefined} - Parsed url, or undefined when it is not one to keep
 */
export function parseVisitUrl(raw: string): URL | undefined {
  if (raw.length > MAX_URL_LENGTH) {
    return undefined
  }

  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return undefined
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined
  }

  return url
}

/**
 * Reads a url's host the way every comparison here makes it: lowercase, as the parser gives it,
 * and without the trailing dot that names the same host absolutely.
 * @param {URL} url - Parsed url
 * @returns {string} - The hostname, ipv6 in brackets
 */
export function hostnameOf(url: URL): string {
  return url.hostname.replace(/\.+$/, '')
}

/**
 * Reads a url's origin with its host in comparable form.
 * @param {URL} url - Parsed url
 * @returns {string} - Scheme, host and any port other than the default
 */
export function originOfUrl(url: URL): string {
  return `${url.protocol}//${hostnameOf(url)}${url.port ? `:${url.port}` : ''}`
}

/**
 * Reduces a url to what is stored: origin and path. The query and fragment go because they are
 * where tokens, sessions and search terms ride, and so do the credentials and the matrix
 * parameters (`;jsessionid=...`), which the parser leaves in the path. The URL parser already
 * lowercases the host and drops a default port. A trailing slash is dropped everywhere but the
 * root, so `/docs` and `/docs/` are one entry.
 * @param {URL} url - Parsed url
 * @returns {string} - Origin and path, the form every comparison here is made in
 */
export function stripUrl(url: URL): string {
  const segments = url.pathname.split('/').map((segment) => segment.split(';')[0] ?? '')
  const path = segments.join('/').replace(/\/+$/, '')

  return `${originOfUrl(url)}${path.length > 0 ? path : '/'}`
}

/**
 * Normalises any url to the stored form, for comparing against what is kept. Anything that would
 * never have been stored answers undefined.
 * @param {string} raw - Url to normalise
 * @returns {string | undefined} - Stored form, or undefined when it is not a web page
 */
export function normaliseUrl(raw: string): string | undefined {
  const url = parseVisitUrl(raw)

  return url ? stripUrl(url) : undefined
}

/**
 * Returns the origin-only form of a stored url, which is where a shell page is folded into.
 * @param {string} stored - Url in stored form
 * @returns {string} - Its origin with the root path
 */
export function originOf(stored: string): string {
  return `${new URL(stored).origin}/`
}
