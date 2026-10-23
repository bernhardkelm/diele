// A domain as someone types it: labels of letters, digits and hyphens, at least two of them, or
// `localhost` on its own, since a dev server is as much a page as anything with a dot in it.
const DOMAIN = /^(localhost|([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,})$/

/**
 * Returns whether a url is a web page, the only kind a kept address may be opened as: anything
 * else as an `href`, a `javascript:` url above all, would run rather than navigate.
 * @param {string} url - Address as it was kept
 * @returns {boolean} - True for an http or https url
 */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)

    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Reduces a url to what two addresses for the same page share, so a trailing slash, a `www.` or
 * a query string does not make one page look like two.
 * @param {string} url - Absolute url to compare
 * @returns {string} - Host and path, lowercased host and no trailing slash; empty when unparseable
 */
export function comparableHref(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.host.replace(/^www\./, '')

    return `${parsed.protocol}//${host}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return ''
  }
}

/**
 * Returns whether a url sits on one of the excluded domains, each of which covers its subdomains.
 * @param {string} url - Absolute url about to be recorded
 * @param {ReadonlyArray<string>} domains - Domains this account never wants kept
 * @returns {boolean} - True when the url's host is one of them or below one
 */
export function isExcludedHost(url: string, domains: ReadonlyArray<string>): boolean {
  let host: string

  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }

  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/**
 * Reads a domain out of whatever was typed for one: a bare host, or a whole address pasted in
 * with its scheme and path, which is the more likely thing to have on the clipboard.
 * @param {string} input - Text from the field
 * @returns {string | undefined} - Lowercased host without `www.`, or undefined when it is none
 */
export function domainFrom(input: string): string | undefined {
  const term = input.trim().toLowerCase()
  if (!term || /\s/.test(term)) {
    return undefined
  }

  let host: string

  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(term) ? term : `https://${term}`).hostname
  } catch {
    return undefined
  }

  const domain = host.replace(/^www\./, '').replace(/\.$/, '')

  return DOMAIN.test(domain) ? domain : undefined
}
