// What the target instance last said about itself, and the four switches read from it: the
// instance's, the extension source's, the account's opt-in and this extension's own toggle.

/**
 * Keeps the strings of a list, cut to a length a list of exclusions or templates never reaches.
 * @param {unknown} raw - A list, of no guaranteed shape
 * @param {number} max - How many entries to keep
 * @returns {string[]} - The strings in it
 */
function stringsOf(raw, max) {
  return Array.isArray(raw) ? raw.filter((entry) => typeof entry === 'string').slice(0, max) : []
}

// Longer than any digest the server hands out as an account
const HISTORY_ACCOUNT_MAX = 200

/**
 * Reads the account a history state names: an opaque value the server derives from the account's
 * history key, which a reset of its main database cannot hand to somebody else the way it can a
 * user id.
 * @param {unknown} state - The served state, of no guaranteed shape
 * @returns {string | undefined} - The account, or undefined when the state names none
 */
function historyAccountOf(state) {
  const account = state !== null && typeof state === 'object' ? state.account : undefined
  const usable =
    typeof account === 'string' && account.length > 0 && account.length <= HISTORY_ACCOUNT_MAX

  return usable ? account : undefined
}

/**
 * Folds what a relay read from the instance into the state the worker keeps. Signed out, the
 * last account is remembered without its switches, so the buffer stays bound to it and nothing
 * records until someone signs in again. Signed in to an account that has never touched history,
 * the state names no account and nothing records either.
 * @param {unknown} previous - The stored state, of no guaranteed shape
 * @param {{signedIn?: unknown, state?: unknown, engineTemplates?: unknown}} report - What the
 *   relay read: whether a session answered, `GET /api/history/state` and the instance's engine
 *   and command templates, which only pass through
 * @param {string} instance - The target scope's url
 * @param {number} now - Current time, in ms since the epoch
 * @returns {object} - The state to store
 */
function historyStateFromReport(previous, report, instance, now) {
  const known = previous !== null && typeof previous === 'object' && previous.instance === instance
  const base = { instance, checkedAt: new Date(now).toISOString() }

  if (report.signedIn !== true) {
    const account = known ? historyAccountOf(previous) : undefined
    return { ...base, signedIn: false, ...(account ? { account } : {}) }
  }

  const state = report.state !== null && typeof report.state === 'object' ? report.state : {}
  const sources = state.sources !== null && typeof state.sources === 'object' ? state.sources : {}
  const account = historyAccountOf(state)
  // Compiled on arrival, so a whole template, with whatever key its other parameters carry, is
  // never written to storage
  const searchPatterns =
    report.engineTemplates === undefined && known
      ? searchPatternsOf(previous.searchPatterns)
      : stringsOf(report.engineTemplates, 500)
          .map((template) => compileSearchTemplate(template))
          .filter((pattern) => pattern !== undefined)

  return {
    ...base,
    signedIn: true,
    ...(account ? { account } : {}),
    available: state.available === true,
    extension: sources.extension === true,
    enabled: state.enabled === true,
    excludedDomains: stringsOf(state.excludedDomains, 200),
    searchPatterns,
    refused: false,
  }
}

/**
 * Returns whether the instance said yes on every one of its switches at the last look, for an
 * account it named.
 * @param {unknown} cached - The stored state, of no guaranteed shape
 * @returns {boolean} - True when the instance, the source and the account all accept visits
 */
function historyAccepted(cached) {
  return (
    cached !== null &&
    typeof cached === 'object' &&
    cached.signedIn === true &&
    historyAccountOf(cached) !== undefined &&
    cached.available === true &&
    cached.extension === true &&
    cached.enabled === true &&
    cached.refused !== true
  )
}

/**
 * Returns whether a loaded page may be recorded right now: a target chosen in this browser, and
 * that very instance accepting visits for a known account.
 * @param {unknown} target - The stored target, of no guaranteed shape
 * @param {unknown} cached - The stored state, of no guaranteed shape
 * @returns {boolean} - True when all four switches are on
 */
function isHistoryRecording(target, cached) {
  const chosen = target !== null && typeof target === 'object' && typeof target.url === 'string'
  return chosen && historyAccepted(cached) && cached.instance === target.url
}

/**
 * Gathers what the filter refuses for the target: every configured instance's origin, since a
 * diele page is never history, and what the instance and the account said to refuse.
 * @param {Array<{url: string}>} instances - Every instance this browser knows
 * @param {{searchPatterns?: object[], excludedDomains?: string[]}} cached - The stored state
 * @returns {{instanceOrigins: string[], searchPatterns: object[], excludedDomains: string[]}} -
 *   The filter
 */
function historyFilterOf(instances, cached) {
  const instanceOrigins = instances
    .map((instance) => parseHistoryUrl(instance.url))
    .filter((url) => url !== undefined)
    .map((url) => historyOrigin(url))

  return {
    instanceOrigins,
    searchPatterns: searchPatternsOf(cached.searchPatterns),
    excludedDomains: stringsOf(cached.excludedDomains, 200),
  }
}

/**
 * Names what an instance's history toggle should say, from what is stored.
 * @param {string} instanceId - The row's instance
 * @param {unknown} target - The stored target, of no guaranteed shape
 * @param {unknown} cached - The stored state, of no guaranteed shape
 * @returns {'off' | 'waiting' | 'unrecognised' | 'signedOut' | 'refused' | 'optIn' | 'recording'} -
 *   The status; waiting until a relay first ran on the instance
 */
function historyStatusOf(instanceId, target, cached) {
  if (target === null || typeof target !== 'object' || target.id !== instanceId) {
    return 'off'
  }

  if (cached === null || typeof cached !== 'object' || cached.instance !== target.url) {
    return 'waiting'
  }

  if (cached.unrecognised === true) {
    return 'unrecognised'
  }

  if (cached.signedIn !== true) {
    return 'signedOut'
  }

  if (cached.refused === true || cached.available !== true || cached.extension !== true) {
    return 'refused'
  }

  return cached.enabled === true && historyAccountOf(cached) !== undefined ? 'recording' : 'optIn'
}
