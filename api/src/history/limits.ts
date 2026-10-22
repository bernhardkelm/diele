import { createBudget } from './budget.js'
import { createLimiter } from './limiter.js'

const WINDOW_MS = 10 * 60_000

/**
 * Probes one account may cause per window. A signed-in account can otherwise make this server
 * request whatever it names, as fast as it can post.
 */
export const probeBudget = createBudget(30, WINDOW_MS)

/**
 * Names one account may have resolved per window. Larger than the probe budget, since a private
 * address costs a lookup and no probe, but bounded all the same: whether a url is kept says
 * whether its name resolves to a private address, which is a map of the internal names.
 */
export const resolveBudget = createBudget(60, WINDOW_MS)

/**
 * Probes in flight across every account. Each one resolves its name again as it connects, on the
 * same four libuv threads the lookups below use.
 */
export const probeLimiter = createLimiter(2, 64)

/**
 * Lookups in flight across every account. Two of libuv's four threads at most, which the file
 * system, crypto, the connectors, the liveness probes and sign-in all share.
 */
export const resolveLimiter = createLimiter(2, 32)

/** How long a batch waits for one name before it counts as not resolving. */
export const RESOLVE_TIMEOUT_MS = 3_000
