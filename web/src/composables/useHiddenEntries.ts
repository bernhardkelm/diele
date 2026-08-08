import { computed, type ComputedRef } from 'vue'
import { ENTRIES_HIDDEN_URL } from '@/config/api'
import { hiddenRefs, refreshConnectorEntries } from '@/composables/useConnectorEntries'

/**
 * Who an entry is hidden for. `all` is the portal's own choice and only an admin may make it;
 * `mine` is this account's, and says nothing about what anyone else sees.
 */
export type HiddenScope = 'all' | 'mine'

export interface HiddenEntries {
  /** Refs hidden for everyone, whoever is looking */
  forEveryone: ComputedRef<ReadonlyArray<string>>
  /** Refs this account hid for itself */
  forMe: ComputedRef<ReadonlyArray<string>>
  /** Returns whether an entry is kept out of the list, in either scope */
  isHidden: (ref: string) => boolean
  /** Returns whether an entry is hidden in one particular scope */
  isHiddenIn: (ref: string, scope: HiddenScope) => boolean
  /** Hides an entry, or brings it back, in one scope */
  toggle: (ref: string, scope: HiddenScope) => Promise<void>
  /** Brings back everything hidden in one scope */
  showAll: (scope: HiddenScope) => Promise<void>
}

/**
 * Tracks what is kept out of the list, in both scopes.
 *
 * Server-side rather than in `localStorage`, which is where this used to live: a choice that
 * only exists on the device that made it is one someone loses by opening the portal somewhere
 * else, and hiding something for everyone is not a device's business at all.
 * @returns {HiddenEntries} - Both hidden sets and the writes that change them
 */
export function useHiddenEntries(): HiddenEntries {
  const forEveryone = computed(() => hiddenRefs.value.all)
  const forMe = computed(() => hiddenRefs.value.mine)

  /**
   * Returns whether an entry is kept out of the list for whoever is looking.
   * @param {string} entryRef - Stable identity of the entry
   * @returns {boolean} - True while either scope hides it
   */
  function isHidden(entryRef: string): boolean {
    return forEveryone.value.includes(entryRef) || forMe.value.includes(entryRef)
  }

  /**
   * Returns whether an entry is hidden in one particular scope.
   * @param {string} entryRef - Stable identity of the entry
   * @param {HiddenScope} scope - Which set to look in
   * @returns {boolean} - True while that scope hides it
   */
  function isHiddenIn(entryRef: string, scope: HiddenScope): boolean {
    return (scope === 'all' ? forEveryone.value : forMe.value).includes(entryRef)
  }

  /**
   * Writes one change and reloads the entries, so both sets come back from the one place that
   * owns them rather than being guessed at here.
   * @param {string} entryRef - Entry to hide or bring back
   * @param {HiddenScope} scope - Which set to change
   * @param {boolean} hidden - True to hide it
   * @returns {Promise<void>}
   */
  async function write(entryRef: string, scope: HiddenScope, hidden: boolean): Promise<void> {
    const response = await fetch(ENTRIES_HIDDEN_URL, {
      method: 'PUT',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ ref: entryRef, scope, hidden }),
    })

    if (!response.ok) {
      // Nothing to show it on: this is a switch in a list, and the list re-reads the truth
      // below anyway, so a failed write shows as the switch staying where it was.
      console.warn(`[diele] hiding ${entryRef} answered ${response.status}`)
    }

    await refreshConnectorEntries()
  }

  return {
    forEveryone,
    forMe,
    isHidden,
    isHiddenIn,
    toggle: (entryRef, scope) => write(entryRef, scope, !isHiddenIn(entryRef, scope)),
    showAll: async (scope) => {
      const refs = scope === 'all' ? [...forEveryone.value] : [...forMe.value]
      for (const entryRef of refs) {
        await write(entryRef, scope, false)
      }
    },
  }
}
