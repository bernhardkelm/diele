import { actionsFor } from '@/features/portal/launchActions'
import { comparableHref, isWebUrl } from '@/helpers/historyUrls'
import type { ApiHistoryEntry } from '@diele/common'
import type { HistoryTarget, PortalTarget } from '@/types/portal'

/**
 * Returns where a visited page sits, as the second column reads it.
 * @param {string} url - Origin and path the entry was kept as
 * @returns {string} - Host and path, without a bare trailing slash; the url itself when unparseable
 */
function displayOf(url: string): string {
  try {
    const parsed = new URL(url)

    return parsed.host.replace(/^www\./, '') + (parsed.pathname === '/' ? '' : parsed.pathname)
  } catch {
    return url
  }
}

/**
 * Builds the search target for one visited page.
 * @param {ApiHistoryEntry} entry - Entry as the api served it
 * @returns {HistoryTarget} - Search-only target opening the page
 */
export function toHistoryTarget(entry: ApiHistoryEntry): HistoryTarget {
  const display = displayOf(entry.url)
  const title = entry.title?.trim()

  return {
    ref: `history:${entry.id}`,
    kind: 'history',
    name: title || display,
    url: entry.url,
    display,
    ...(title ? { title } : {}),
    keywords: [],
    searchOnly: true,
  }
}

/**
 * Turns the visited pages into search targets, leaving out any the portal already reaches and
 * any that is not a web page, since its url becomes the row's `href`.
 *
 * The api deduplicates against the cards, sites and connector rows already, so this only catches
 * what an exact comparison there would miss: a trailing slash, a `www.` or a query string on the
 * saved side. Every action of a known target counts, so a repo's pipelines page that was opened
 * once is still offered as the repo's own link rather than a second time as a visited page.
 * @param {ReadonlyArray<ApiHistoryEntry>} entries - Visited pages, most frecent first
 * @param {ReadonlyArray<PortalTarget>} known - Everything else the launcher searches
 * @returns {ReadonlyArray<HistoryTarget>} - Targets for the pages nothing else reaches, in order
 */
export function historyTargets(
  entries: ReadonlyArray<ApiHistoryEntry>,
  known: ReadonlyArray<PortalTarget>,
): ReadonlyArray<HistoryTarget> {
  if (entries.length === 0) {
    return []
  }

  const reached = new Set<string>()

  for (const target of known) {
    for (const action of actionsFor(target)) {
      const href = action.href ? comparableHref(action.href) : ''
      if (href) {
        reached.add(href)
      }
    }
  }

  return entries
    .filter((entry) => isWebUrl(entry.url) && !reached.has(comparableHref(entry.url)))
    .map(toHistoryTarget)
}
