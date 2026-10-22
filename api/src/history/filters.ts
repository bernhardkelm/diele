import { classifyHostname, isUnreachable } from './addresses.js'
import { isCapabilityLink } from './capabilityLinks.js'
import { isOnDomain } from './domains.js'
import { hostnameOf, originOfUrl, parseVisitUrl, stripUrl } from './normalise.js'
import { isSearchPage } from './searchPages.js'
import { hasTokenSegment } from './tokens.js'

export interface VisitFilter {
  /** Origin diele itself is served on, whose own pages are never history */
  readonly ownOrigin: string
  /** Url templates of the configured search engines and slash commands */
  readonly engineTemplates: ReadonlyArray<string>
  /** The account's excluded domains, normalised */
  readonly excludedDomains: ReadonlyArray<string>
}

/**
 * Decides whether a reported url is kept, and in what form. A search page is judged on the url as
 * it arrived, because it is told apart by its query; the path checks run on the stripped path,
 * which is what would be stored. A host is judged here only as far as its name says: what it
 * resolves to is the probe's question, asked for the portal's own visits.
 * @param {string} raw - Url as the source reported it
 * @param {VisitFilter} filter - What this account and this portal refuse
 * @returns {string | undefined} - The url in stored form, or undefined when the visit is dropped
 */
export function acceptVisit(raw: string, filter: VisitFilter): string | undefined {
  const url = parseVisitUrl(raw)
  if (!url) {
    return undefined
  }

  const hostname = hostnameOf(url)
  if (originOfUrl(url) === filter.ownOrigin || isUnreachable(classifyHostname(hostname))) {
    return undefined
  }

  if (filter.excludedDomains.some((domain) => isOnDomain(hostname, domain))) {
    return undefined
  }

  if (isSearchPage(url, filter.engineTemplates)) {
    return undefined
  }

  const stored = stripUrl(url)
  const path = new URL(stored).pathname

  return hasTokenSegment(path) || isCapabilityLink(path) ? undefined : stored
}
