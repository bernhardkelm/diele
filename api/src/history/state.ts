import type { ApiHistoryState, HistorySource } from '@diele/common'
import { isEnabled } from '#settings/toggles.js'
import { accountTag } from './account.js'
import { countEntries } from './entries.js'
import { readPreferences } from './preferences.js'

/** The admin switch each source is held under, beneath the feature's own. */
const SOURCE_TOGGLES: Readonly<Record<HistorySource, string>> = {
  diele: 'historyDiele',
  extension: 'historyExtension',
}

/**
 * Returns whether the instance offers history at all.
 * @returns {boolean} - The admin's switch for the whole feature
 */
export function isAvailable(): boolean {
  return isEnabled('history')
}

/**
 * Returns whether the instance accepts visits from a source. A source switched on beneath a
 * feature that is off accepts nothing, so turning the feature off needs no second click.
 * @param {HistorySource} source - Where the visits come from
 * @returns {boolean} - True when both switches are on
 */
export function isSourceOn(source: HistorySource): boolean {
  return isAvailable() && isEnabled(SOURCE_TOGGLES[source])
}

/**
 * Describes what the portal should show an account: what the instance offers, what the account
 * chose, how much it keeps, and the tag its history is known by once it has a key.
 * @param {string | undefined} owner - The account's history key, undefined when it has none
 * @returns {ApiHistoryState} - The state, always served
 */
export function readState(owner: string | undefined): ApiHistoryState {
  const preferences = readPreferences(owner)

  return {
    available: isAvailable(),
    sources: { diele: isSourceOn('diele'), extension: isSourceOn('extension') },
    enabled: preferences.enabled,
    excludedDomains: preferences.excludedDomains,
    kept: countEntries(owner),
    ...(owner === undefined ? {} : { account: accountTag(owner) }),
  }
}

/**
 * Returns whether a visit from a source may be recorded for an account right now. Asked again
 * after a probe, since a switch or the opt-in can change while one is in flight.
 * @param {string | undefined} owner - The account's history key, undefined when it has none
 * @param {HistorySource} source - Where it came from
 * @returns {boolean} - True when the instance, the source and the account all say yes
 */
export function canRecord(owner: string | undefined, source: HistorySource): boolean {
  return isSourceOn(source) && readPreferences(owner).enabled
}
