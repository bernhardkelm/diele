// Which instance may receive visits, and the exact part of the web the relay is allowed to run on.

// Plain http is accepted on these alone, for an instance under development on this machine.
// Anywhere else the session cookie and the visits would cross the network in the clear.
const HISTORY_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1'])

/**
 * Returns whether this browser's match patterns may name a port. Chrome's may; Firefox's may not
 * and refuses a pattern that does, so there a pattern covers every port of the host and the
 * worker's own scope check, which compares the full origin, is what keeps the relay to the one.
 * Told apart by runtime.getBrowserInfo, which only Firefox has.
 * @returns {boolean} - True when a pattern can carry a port
 */
function historyPatternPorts() {
  const firefox =
    typeof browser === 'object' &&
    browser !== null &&
    typeof browser.runtime?.getBrowserInfo === 'function'

  return !firefox
}

/**
 * Describes where history for an instance would go: its origin, its path prefix, the match
 * patterns the relay is registered on and the host permission that covers them.
 * @param {string} instanceUrl - The instance's stored address
 * @param {boolean} [ports] - Whether match patterns may carry a port, this browser's answer by default
 * @returns {{url: string, origin: string, path: string, matches: string[], permission: string} | undefined} -
 *   The scope, or undefined when the instance may not receive visits
 */
function historyScopeOf(instanceUrl, ports = historyPatternPorts()) {
  let parsed

  try {
    parsed = new URL(instanceUrl)
  } catch {
    return undefined
  }

  const secure = parsed.protocol === 'https:'
  const loopback = parsed.protocol === 'http:' && HISTORY_LOOPBACK_HOSTS.has(parsed.hostname)

  if (!secure && !loopback) {
    return undefined
  }

  const origin = parsed.origin
  const path = parsed.pathname
  const base = ports ? origin : `${parsed.protocol}//${parsed.hostname}`

  // A path without its trailing slash names a page and the tree below it, never `/portalx`
  const matches = path.endsWith('/')
    ? [`${base}${path}*`]
    : [`${base}${path}`, `${base}${path}/*`, `${base}${path}?*`]

  return { url: `${origin}${path}`, origin, path, matches, permission: `${base}/*` }
}

/**
 * Returns whether a page lies inside a scope: the same origin, and the scope's path or below it.
 * @param {unknown} url - Address of the page, of no guaranteed shape
 * @param {{origin: string, path: string}} scope - Where history goes
 * @returns {boolean} - True when the page belongs to the target instance
 */
function isInHistoryScope(url, scope) {
  let parsed

  try {
    parsed = new URL(String(url))
  } catch {
    return false
  }

  if (parsed.origin !== scope.origin) {
    return false
  }

  const below = scope.path.endsWith('/') ? scope.path : `${scope.path}/`
  return parsed.pathname === scope.path || parsed.pathname.startsWith(below)
}
