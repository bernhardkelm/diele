import { config } from '#config.js'
import { mapLimit } from '#health/pool.js'
import {
  INSTANCE,
  instanceResolveBudget,
  probeBudget,
  probeLimiter,
  RESOLVE_TIMEOUT_MS,
  resolveBudget,
  resolveLimiter,
} from './limits.js'
import { hostnameOf } from './normalise.js'
import { pageExists } from './probe.js'
import { literalAddress, publicAddress, type Resolver, resolveAll } from './resolve.js'

/** Urls of one batch judged at once; the lookups and probes behind them are capped globally. */
const RESOLVE_CONCURRENCY = 4

export interface AdmissionChecks {
  /** Every address a name resolves to */
  readonly resolve?: Resolver
  /** Whether a public page answers, asked of the address its host was vetted at */
  readonly exists?: (url: string, address: string) => Promise<boolean>
}

/**
 * Finds the address a host may be probed at, if any. A literal needs no lookup. A name is
 * resolved only while the account and the instance both have lookups left, and neither is charged
 * unless both have, so other accounts' traffic cannot spend this one's. It counts as public only
 * when every address it has is. Running out of budget, a full queue, a timeout, a name that does
 * not resolve and one that leads anywhere but the public internet all end the same way: no address.
 * @param {string} owner - The account's history key
 * @param {string} hostname - Host, trailing dot removed
 * @param {Resolver} resolve - How a name is resolved
 * @returns {Promise<string | undefined>} - The public address to pin a probe to, or undefined
 */
async function vettedAddress(
  owner: string,
  hostname: string,
  resolve: Resolver,
): Promise<string | undefined> {
  const literal = literalAddress(hostname)
  if (literal !== undefined) {
    return publicAddress([literal])
  }

  // Both asked before either is charged, so a refusal by the instance costs the account nothing.
  const now = Date.now()
  if (!instanceResolveBudget.has(INSTANCE, now) || !resolveBudget.has(owner, now)) {
    return undefined
  }

  instanceResolveBudget.take(INSTANCE, now)
  resolveBudget.take(owner, now)

  return publicAddress(await resolveLimiter.run(() => resolve(hostname), RESOLVE_TIMEOUT_MS))
}

/**
 * Decides whether one url opened through Go to, and not yet kept for the account, is kept. The
 * name checks have already dropped what must never be stored. What is left is probed only when its
 * host resolves to public addresses alone and the account has probes left; then a 404, a 410 or
 * no answer drops it. Everything else is kept unprobed: a private network, a name that resolves to
 * loopback or link-local, one that does not resolve or not in time, and a budget or queue that is
 * spent. Whether an entry appears thus says nothing about what the server's resolver knows, and the
 * one-off prune clears a typo.
 * @param {string} owner - The account's history key
 * @param {string} url - Url in stored form
 * @param {AdmissionChecks} checks - How hosts are resolved and pages asked about
 * @returns {Promise<boolean>} - True when the visit should be recorded
 */
async function admit(owner: string, url: string, checks: AdmissionChecks): Promise<boolean> {
  const resolve = checks.resolve ?? resolveAll
  const exists = checks.exists ?? ((target: string, address: string) => pageExists(target, address))

  const address = await vettedAddress(owner, hostnameOf(new URL(url)), resolve)
  if (address === undefined || !config.history.probe || !probeBudget.take(owner)) {
    return true
  }

  // A probe the full queue dropped answers undefined, and is kept like any other unprobed url.
  return (await probeLimiter.run(() => exists(url, address))) !== false
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
