import { moduleFor } from '#connectors/registry.js'
import { badRequest } from '#errors.js'
import { readSetting, writeSetting } from './repository.js'

/**
 * Features the whole portal can be told to ignore, and the setting each is held in. A feature
 * missing from here has nothing to turn off, which is what the admin route checks before it
 * writes anything.
 */
const KEYS: Readonly<Record<string, string>> = {
  cards: 'cards.enabled',
  sites: 'sites.enabled',
  engines: 'engines.enabled',
  localhost: 'localhost.enabled',
  reddit: 'reddit.enabled',
  health: 'health.enabled',
}

/**
 * Slash commands and users are deliberately absent: the built-in commands are how admin mode,
 * the settings menu and signing out are reached, so a portal that turned them off would have
 * no way back in, and an account list is not a feature to switch off.
 *
 * Features that stay off until someone asks for them. Probing local ports costs a request per
 * port on every load, so a portal that is not a development machine should not do it unasked.
 * Everything else defaults on: it costs nothing until it matches, and defaulting it off would
 * mean a fresh portal quietly missing behaviour it never said it had turned off.
 */
const DEFAULT_OFF: ReadonlySet<string> = new Set(['localhost'])

/**
 * Resolves the setting a feature's switch is held in. Connector types are not listed in `KEYS`
 * because the registry already names them: every registered connector can be switched off as a
 * whole, the way a built-in feature can.
 * @param {string} id - Feature being addressed
 * @returns {string | undefined} - Setting key, or undefined when there is nothing to switch
 */
function keyFor(id: string): string | undefined {
  return KEYS[id] ?? (moduleFor(id) ? `connector.${id}.enabled` : undefined)
}

/**
 * Returns whether a feature is one that can be turned off at all.
 * @param {string} id - Feature being addressed
 * @returns {boolean} - True when it has a setting behind it
 */
export function isToggleable(id: string): boolean {
  return keyFor(id) !== undefined
}

/**
 * Returns whether a feature is on.
 * @param {string} id - Feature to read
 * @returns {boolean} - True when the portal should offer it
 */
export function isEnabled(id: string): boolean {
  const key = keyFor(id)
  if (!key) {
    return false
  }

  const value = readSetting(key)

  return DEFAULT_OFF.has(id) ? value === true : value !== false
}

/**
 * Turns a feature on or off for the whole portal.
 * @param {string} id - Feature to write
 * @param {boolean} enabled - Whether it should be offered
 * @returns {void}
 */
export function setEnabled(id: string, enabled: boolean): void {
  const key = keyFor(id)
  if (!key) {
    throw badRequest('that feature cannot be turned off')
  }

  writeSetting(key, enabled)
}
