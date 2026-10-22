import { config } from '#config.js'
import { mapLimit } from '#health/pool.js'
import type { AddressClass } from './addresses.js'
import { hostnameOf } from './normalise.js'
import { pageExists } from './probe.js'
import {
  probeBudget,
  probeLimiter,
  RESOLVE_TIMEOUT_MS,
  resolveBudget,
  resolveLimiter,
} from './limits.js'
import { classifyHost } from './resolve.js'

/** Urls of one batch judged at once; the lookups and probes behind them are capped globally. */
const RESOLVE_CONCURRENCY = 4

export interface AdmissionChecks {
  /** Where a host leads, after resolving it */
  readonly classify?: (hostname: string) => Promise<AddressClass | undefined>
  /** Whether a public page answers */
  readonly exists?: (url: string) => Promise<boolean>
}

/**
 * Decides whether one url opened through Go to, and not yet kept for the account, is kept. What
 * it resolves to decides how: loopback, link-local and metadata addresses are dropped and never
 * requested; a private network is kept unprobed, so the outcome says nothing about what answers
 * there, and the one-off prune clears a typo; a public address is probed when probing is on and
 * the account has budget left. A name that does not resolve in time, or that the account has no
 * lookups left for, or that finds the lookups full, is not a page.
 * @param {string} owner - The account's history key
 * @param {string} url - Url in stored form
 * @param {AdmissionChecks} checks - How hosts are resolved and pages asked about
 * @returns {Promise<boolean>} - True when the visit should be recorded
 */
async function admit(owner: string, url: string, checks: AdmissionChecks): Promise<boolean> {
  const classify = checks.classify ?? ((hostname: string) => classifyHost(hostname))
  const exists = checks.exists ?? ((target: string) => pageExists(target))
  if (!resolveBudget.take(owner)) {
    return false
  }

  const hostname = hostnameOf(new URL(url))
  const where = await resolveLimiter.run(() => classify(hostname), RESOLVE_TIMEOUT_MS)

  if (where === 'private') {
    return true
  }

  if (where !== 'public') {
    return false
  }

  if (!config.history.probe) {
    return true
  }

  if (!probeBudget.take(owner)) {
    return false
  }

  return (await probeLimiter.run(() => exists(url))) === true
}

/**
 * Decides which of a batch's new urls are kept.
 * @param {string} owner - The account's history key
 * @param {ReadonlyArray<string>} urls - Distinct urls in stored form, none already kept
 * @param {AdmissionChecks} checks - How hosts are resolved and pages asked about
 * @returns {Promise<ReadonlySet<string>>} - The urls to record
 */
export async function admitted(
  owner: string,
  urls: ReadonlyArray<string>,
  checks: AdmissionChecks = {},
): Promise<ReadonlySet<string>> {
  const verdicts = await mapLimit(urls, RESOLVE_CONCURRENCY, (url) => admit(owner, url, checks))

  return new Set(urls.filter((_url, index) => verdicts[index] === true))
}
