import type { ApiHistoryVisits } from '@diele/common'
import { config } from '#config.js'
import { listAllCommands } from '#commands/repository.js'
import { listAllEngines } from '#engines/repository.js'
import { admitted, type AdmissionChecks } from './admission.js'
import { commitVisits } from './commit.js'
import { hasEntry } from './entries.js'
import { acceptVisit, type VisitFilter } from './filters.js'
import { originOfUrl } from './normalise.js'
import { readPreferences } from './preferences.js'
import type { Visit } from './record.js'

const DAY_MS = 24 * 60 * 60_000

/** How far back a reported visit may be dated; older ones are dated this far back. */
const OLDEST_VISIT_MS = 30 * DAY_MS

/** Batches one account may have in flight; another is refused until one of them settles. */
export const MAX_IN_FLIGHT = 2

/** Batches still being probed or written, so a test can wait for them. */
const pending = new Set<Promise<void>>()

/** How many batches each account has in flight. */
const inFlight = new Map<string, number>()

/**
 * Reads the origin diele is served on, in the form a parsed url's is compared in.
 * @returns {string} - The portal's origin
 */
function ownOrigin(): string {
  try {
    return originOfUrl(new URL(config.publicOrigin))
  } catch {
    return config.publicOrigin
  }
}

/**
 * Gathers what an account and this portal refuse to record. Every engine and slash command
 * counts, the switched off ones too: their results pages are search pages all the same.
 * @param {ReadonlyArray<string>} excludedDomains - The account's excluded domains
 * @returns {VisitFilter} - The filter to judge a batch by
 */
function filterFor(excludedDomains: ReadonlyArray<string>): VisitFilter {
  return {
    ownOrigin: ownOrigin(),
    engineTemplates: [
      ...listAllEngines().map((engine) => engine.urlTemplate),
      ...listAllCommands().map((command) => command.urlTemplate),
    ],
    excludedDomains,
  }
}

/**
 * Dates a visit. A source's clock is its own, so the time it reports is held between thirty days
 * ago and now: later would keep an entry on top until that day came, and much earlier is either
 * wrong or a backfill this is not for.
 * @param {string | undefined} at - ISO 8601, as the source reported it
 * @param {number} now - Current time, in ms since the epoch
 * @returns {string} - ISO 8601, within the window
 */
function visitedAt(at: string | undefined, now: number): string {
  const parsed = at === undefined ? Number.NaN : Date.parse(at)
  const stamp = Number.isNaN(parsed) ? now : Math.min(now, Math.max(now - OLDEST_VISIT_MS, parsed))

  return new Date(stamp).toISOString()
}

/**
 * Filters, checks and records one batch of visits. A url opened through diele's own bar is only
 * kept once admitted, so a mistyped address never becomes a suggestion; one the account already
 * holds is counted straight away. The extension's visits are not probed: the browser saw them load.
 * @param {string} owner - The account's history key
 * @param {ApiHistoryVisits} batch - Visits as the source reported them
 * @param {AdmissionChecks} checks - How hosts are resolved and pages asked about
 * @returns {Promise<void>}
 */
export async function ingestVisits(
  owner: string,
  batch: ApiHistoryVisits,
  checks: AdmissionChecks = {},
): Promise<void> {
  const preferences = readPreferences(owner)
  const filter = filterFor(preferences.excludedDomains)
  const now = Date.now()
  const visits: Visit[] = []

  const probed = batch.source === 'diele'

  // The portal only ever sends back a title this server served it, so a title from it is never
  // news, and it would be the cheapest way to mint shell pages by the batch.
  for (const visit of batch.visits) {
    const url = acceptVisit(visit.url, filter)
    if (url) {
      visits.push({ url, title: probed ? undefined : visit.title, at: visitedAt(visit.at, now) })
    }
  }

  const known = visits.filter((visit) => !probed || hasEntry(owner, visit.url))
  const unknown = visits.filter((visit) => !known.includes(visit))

  commitVisits(owner, batch.source, known, preferences.forgetEpoch)

  if (unknown.length === 0) {
    return
  }

  const kept = await admitted(owner, [...new Set(unknown.map((visit) => visit.url))], checks)

  commitVisits(
    owner,
    batch.source,
    unknown.filter((visit) => kept.has(visit.url)),
    preferences.forgetEpoch,
  )
}

/**
 * Runs a batch in the background, after the request has been answered. A failure is dropped
 * without a word about the batch: nobody is waiting for it, a lost visit costs one suggestion,
 * and a log line naming the url would keep what the account may since have deleted.
 *
 * An account with as many batches in flight as it may have is refused, so one account posting as
 * fast as it can holds a bounded amount of memory and work rather than all of it.
 * @param {string} owner - The account's history key
 * @param {ApiHistoryVisits} batch - Visits as the source reported them
 * @param {AdmissionChecks} checks - How hosts are resolved and pages asked about
 * @returns {boolean} - True when the batch was started, false when the account is at its limit
 */
export function startIngest(
  owner: string,
  batch: ApiHistoryVisits,
  checks: AdmissionChecks = {},
): boolean {
  const running = inFlight.get(owner) ?? 0
  if (running >= MAX_IN_FLIGHT) {
    return false
  }

  inFlight.set(owner, running + 1)

  const job = ingestVisits(owner, batch, checks)
    .catch(() => {
      console.error('[history] a batch of visits could not be recorded')
    })
    .finally(() => {
      pending.delete(job)

      const left = (inFlight.get(owner) ?? 1) - 1
      if (left > 0) {
        inFlight.set(owner, left)
      } else {
        inFlight.delete(owner)
      }
    })

  pending.add(job)
  return true
}

/**
 * Waits until every batch in the background has been probed and written.
 * @returns {Promise<void>}
 */
export async function whenIngested(): Promise<void> {
  await Promise.all(pending)
}
