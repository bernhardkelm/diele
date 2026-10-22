import { computed, watch, type ComputedRef } from 'vue'
import { useHistory } from '@/composables/useHistory'
import { historySection } from '@/features/settings/historySection'
import type { SettingsSection } from '@/features/settings/settingsSections'
import { domainFrom } from '@/helpers/historyUrls'

const SECTION_ID = 'history'

/**
 * Wires the history section to the account's history: built only where the instance offers it,
 * and reading every kept page each time it is opened, since that list lives on the api and is
 * the one thing in settings that can have changed while the view was closed.
 * @param {() => string | undefined} expanded - Section whose rows are on screen
 * @returns {ComputedRef<SettingsSection | undefined>} - The section, or undefined where history is not offered
 */
export function useHistorySection(
  expanded: () => string | undefined,
): ComputedRef<SettingsSection | undefined> {
  const { state, kept, keptStatus, loadKept, setPreferences, remove, clear } = useHistory(
    () => true,
  )

  watch(
    () => state.value.available && expanded() === SECTION_ID,
    (open) => {
      if (open) {
        void loadKept()
      }
    },
    { immediate: true },
  )

  /**
   * Adds an excluded domain, from a bare host or a whole pasted address.
   * @param {string} input - What was typed into the field
   * @returns {Promise<string | undefined>} - Why it was refused, or undefined once it is excluded
   */
  async function exclude(input: string): Promise<string | undefined> {
    const domain = domainFrom(input)
    if (!domain) {
      return 'that is not a domain, try one like example.com'
    }

    const current = state.value.excludedDomains
    if (current.includes(domain)) {
      return `${domain} is already excluded`
    }

    const taken = await setPreferences({ excludedDomains: [...current, domain] })

    return taken ? undefined : 'the portal did not take it, try again'
  }

  /**
   * Takes a domain off the excluded list. Nothing kept comes back: what excluding it forgot is gone.
   * @param {string} domain - Domain to record again
   * @returns {Promise<void>}
   */
  async function include(domain: string): Promise<void> {
    const excludedDomains = state.value.excludedDomains.filter((entry) => entry !== domain)

    await setPreferences({ excludedDomains })
  }

  return computed(() => {
    if (!state.value.available) {
      return undefined
    }

    return historySection({
      state: state.value,
      kept: kept.value,
      keptStatus: keptStatus.value,
      setEnabled: (enabled) => void setPreferences({ enabled }),
      exclude,
      include,
      remove: async (id) => {
        await remove(id)
      },
      clear: async () => {
        await clear()
      },
    })
  })
}
