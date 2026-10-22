import { listLinks } from '#links/repository.js'
import { isEnabled } from '#settings/toggles.js'
import { listLocalhost } from './repository.js'

// The hosts web/src/helpers/localhost.ts probes, less `[::1]`, which no CSP source can name.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1'])

/**
 * Returns whether a url points at a loopback host the policy can allow.
 * @param {string} url - Absolute url to test
 * @returns {boolean} - True for localhost and 127.0.0.1
 */
function isLoopback(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * Returns whether the portal as configured right now has the browser probe a loopback port.
 *
 * The same rows `/api/config` serves, because the frontend probes every saved site and every
 * local port in that payload whose host is loopback: an enabled port while the feature is on, and
 * a saved site pointing at localhost whether the feature is on or not.
 * @returns {boolean} - True when at least one probe will target this machine
 */
export function probesLoopback(): boolean {
  if (isEnabled('localhost') && listLocalhost().length > 0) {
    return true
  }

  return isEnabled('sites') && listLinks('site').some((link) => isLoopback(link.url))
}
