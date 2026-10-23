import type { ApiHistoryEntry } from '@diele/common'
import { config } from '#config.js'
import { listEntries as listConnectorEntries } from '#connectors/entries.js'
import { listLinks } from '#links/repository.js'
import { isEnabled } from '#settings/toggles.js'
import { listEntries } from './entries.js'
import { byFrecency } from './frecency.js'
import { normaliseUrl } from './normalise.js'

/**
 * Collects every url the portal offers on its own right now, in stored form. A history line for a
 * card the person clicked every day would only repeat the card, one row further down. The same
 * switches `/api/config` and `/api/entries` honour apply: a section switched off offers nothing,
 * so its urls are history like any other.
 * @returns {ReadonlySet<string>} - Urls of the cards, saved sites and connector entries served
 */
export function knownUrls(): ReadonlySet<string> {
  const urls = [
    ...(isEnabled('cards') ? listLinks('card') : []).map((link) => link.url),
    ...(isEnabled('sites') ? listLinks('site') : []).map((link) => link.url),
    ...listConnectorEntries()
      .filter((entry) => isEnabled(entry.connectorType))
      .map((entry) => entry.url),
  ]

  return new Set(urls.map(normaliseUrl).filter((url): url is string => url !== undefined))
}

/**
 * Picks what the portal's search is given: the account's most frecent entries, less whatever
 * the portal already offers, capped.
 * @param {string | undefined} owner - The account's history key, undefined when it has none
 * @param {number} now - Current time, in ms since the epoch
 * @returns {ReadonlyArray<ApiHistoryEntry>} - Entries, most frecent first
 */
export function servedEntries(
  owner: string | undefined,
  now: number = Date.now(),
): ReadonlyArray<ApiHistoryEntry> {
  const entries = listEntries(owner)
  if (entries.length === 0) {
    return []
  }

  const known = knownUrls()
  const fresh = entries.filter((entry) => !known.has(entry.url))

  return byFrecency(fresh, now).slice(0, config.history.served)
}
