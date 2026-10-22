/** A list longer than this is no longer a list of exceptions. */
export const MAX_EXCLUDED_DOMAINS = 200

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

/**
 * Reduces what someone typed as a domain to a bare lowercase hostname. A pasted url is accepted
 * and cut down to its host, since that is what copying from the address bar gives; a leading
 * `*.` or `.` is dropped because every domain here covers its subdomains anyway.
 * @param {string} raw - Domain as written
 * @returns {string | undefined} - The hostname, or undefined when it is not one
 */
export function normaliseDomain(raw: string): string | undefined {
  let value = raw.trim().toLowerCase()

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.replace(/[/?#].*$/, '')
  value = value.replace(/:\d+$/, '')
  value = value.replace(/^\*?\.+/, '').replace(/\.+$/, '')

  if (value.length === 0 || value.length > 253) {
    return undefined
  }

  // An internationalised name is kept the way the URL parser writes it, which is how a stored
  // url's host reads, so the two compare.
  let hostname: string

  try {
    hostname = new URL(`http://${value}/`).hostname
  } catch {
    return undefined
  }

  if (hostname.length === 0 || !hostname.split('.').every((label) => LABEL.test(label))) {
    return undefined
  }

  return hostname
}

/**
 * Returns whether a host is the domain itself or one of its subdomains.
 * @param {string} hostname - Host to test, lowercase
 * @param {string} domain - Domain in normalised form
 * @returns {boolean} - True when the host falls under the domain
 */
export function isOnDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}
