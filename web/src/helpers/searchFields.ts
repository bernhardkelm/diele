import type { HistoryTarget, PortalTarget } from '@/types/portal'

export interface SearchField {
  readonly text: string
  /** Multiplier on the field's score, so a name outranks the host it happens to sit on */
  readonly weight: number
}

const NAME = 1
const PATH = 0.9
const KEYWORD = 0.85
const CAPTION = 0.6
// low enough that a term hitting nothing but a shared domain sorts under every real match
const HOST = 0.45

// A visited page is known by its site first: what someone types to find heise.de again is
// `heise`, not the page's title, and least of all a segment of its path.
const SITE_NAME = 1
const PAGE_TITLE = 0.9
const PAGE_HOST = 0.6
const PAGE_PATH = 0.5

// an address rather than a name, so it has no suffix to take off
const IP_HOST = /^[\d.]+$|:/

/**
 * Returns the host a url points at, without the `www.` nobody types.
 * @param {string} url - Absolute url of a target
 * @returns {string} - Host including its port, empty when the url is unparseable
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Returns the name of the site a url points at: its host without the `www.` and without the last
 * label, so `www.heise.de` reads as `heise`. A suffix of two labels keeps its first one
 * (`bbc.co`), which still holds the name, and is simpler than a list of public suffixes.
 * @param {string} url - Absolute url of a target
 * @returns {string} - Site name, the whole host for a single label or an ip address, empty when unparseable
 */
export function siteNameOf(url: string): string {
  let hostname: string
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }

  const dot = hostname.lastIndexOf('.')
  if (dot <= 0 || IP_HOST.test(hostname)) {
    return hostname
  }

  return hostname.slice(0, dot)
}

/**
 * Returns the path a url points at as its segments, without the slashes either side, so each
 * segment matches as a word of its own.
 * @param {string} url - Absolute url of a target
 * @returns {string} - Path without its leading and trailing slash, empty for a bare origin
 */
function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\/+|\/+$/g, '')
  } catch {
    return ''
  }
}

/**
 * Returns the texts a visited page is searched over. It has no keywords and often no title, so
 * its address is most of what there is to find it by, read from the site name outwards.
 * @param {HistoryTarget} target - Visited page to describe
 * @returns {ReadonlyArray<SearchField>} - Weighted fields, the site name first
 */
function historyFields(target: HistoryTarget): ReadonlyArray<SearchField> {
  const fields: SearchField[] = []

  for (const [text, weight] of [
    [siteNameOf(target.url), SITE_NAME],
    // the title, or the address the row shows in its place
    [target.name, PAGE_TITLE],
    [hostOf(target.url), PAGE_HOST],
    [pathOf(target.url), PAGE_PATH],
  ] as const) {
    if (text) {
      fields.push({ text, weight })
    }
  }

  return fields
}

/**
 * Returns the texts a target is searched over, each weighted by how much a hit on it says.
 * Matching the fields rather than the whole url is what keeps `lab` or `com` from matching
 * every repo through the `gitlab.com` they all share.
 * @param {PortalTarget} target - Target to describe
 * @returns {ReadonlyArray<SearchField>} - Weighted fields, the name first, or a visited page's site name
 */
export function fieldsFor(target: PortalTarget): ReadonlyArray<SearchField> {
  if (target.kind === 'history') {
    return historyFields(target)
  }

  const fields: SearchField[] = [{ text: target.name, weight: NAME }]

  if (target.kind === 'row' && target.detail) {
    // every repo sits on the same host, so only the namespace says which one this is
    fields.push({ text: target.detail, weight: PATH })
  }

  if (target.kind === 'command') {
    fields.push({ text: target.hint, weight: CAPTION })
  }

  if (target.kind === 'suggestion' && target.display) {
    fields.push({ text: target.display, weight: CAPTION })
  }

  for (const keyword of target.keywords ?? []) {
    if (keyword) {
      fields.push({ text: keyword, weight: KEYWORD })
    }
  }

  // Cards and rows sit on a handful of shared domains, so a term hitting one would raise every
  // card or every repo at once. Only a suggestion is worth finding by its host.
  if (target.kind !== 'suggestion') {
    return fields
  }

  const host = hostOf(target.url)
  if (host) {
    fields.push({ text: host, weight: HOST })
  }

  return fields
}
