import { createBudget } from './budget.js'
import { createLimiter } from './limiter.js'

const WINDOW_MS = 10 * 60_000

/** What the instance-wide budgets are filed under, beside the per-account ones. */
export const INSTANCE = '*'

/**
 * Probes one account may cause per window. A signed-in account can otherwise make this server
 * request whatever it names, as fast as it can post. Past it a url is kept unprobed.
 */
export const probeBudget = createBudget(30, WINDOW_MS)

/**
 * Names one account may have resolved per window. Larger than the probe budget, since a name that
 * is not public costs a lookup and no probe. Past it a url is kept unprobed, the same outcome as
 * any name that is not public, so the budget caps the load and gives nothing away.
 */
export const resolveBudget = createBudget(60, WINDOW_MS)

/**
 * Names resolved per window across every account, so many accounts together cannot turn this
 * server's resolver into a scanner of someone else's zone.
 */
export const instanceResolveBudget = createBudget(600, WINDOW_MS)

/**
 * Visits from the extension one account may post per window. None of them is resolved or probed,
 * but each is a write, and a page script can post as the extension. Past it the batch is refused
 * with a 429, which the extension keeps and sends again.
 */
export const extensionVisitBudget = createBudget(2000, WINDOW_MS)

/** Probes in flight across every account, each one a connection to a pinned address. */
export const probeLimiter = createLimiter(2, 64)

/**
 * Lookups in flight across every account. They go through c-ares and hold no libuv thread, so
 * this bounds the queries this server has out at once rather than guarding the thread pool.
 */
export const resolveLimiter = createLimiter(4, 32)

/** How long a batch waits for one name, queueing included, before it counts as not public. */
export const RESOLVE_TIMEOUT_MS = 3_000
