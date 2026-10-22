import type { HistorySource } from '@diele/common'
import { getHistoryDb } from './db.js'
import { isOnDomain } from './domains.js'
import { readPreferences } from './preferences.js'
import { recordVisit, type Visit } from './record.js'
import { canRecord } from './state.js'

/**
 * Writes visits, asking every gate again at the moment of writing. A probe can take seconds, and
 * in that time an admin may switch the source off, the account may opt out, exclude the domain or
 * delete what it held; the epoch is what says a delete happened since the batch arrived.
 * @param {string} owner - The account's history key
 * @param {HistorySource} source - Where the visits came from
 * @param {ReadonlyArray<Visit>} visits - Visits that passed the filters
 * @param {number} epoch - The account's forget epoch when the batch arrived
 * @returns {void}
 */
export function commitVisits(
  owner: string,
  source: HistorySource,
  visits: ReadonlyArray<Visit>,
  epoch: number,
): void {
  if (visits.length === 0) {
    return
  }

  const db = getHistoryDb()

  db.transaction(() => {
    const preferences = readPreferences(owner)

    if (!canRecord(owner, source) || preferences.forgetEpoch !== epoch) {
      return
    }

    for (const visit of visits) {
      const hostname = new URL(visit.url).hostname

      if (!preferences.excludedDomains.some((domain) => isOnDomain(hostname, domain))) {
        recordVisit(owner, visit)
      }
    }
  })()
}
