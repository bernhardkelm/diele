import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { WriteOutcome } from '@/composables/historyWrite'
import { useHistory } from '@/composables/useHistory'
import { useHistoryDelivery } from '@/composables/useHistoryDelivery'
import { useHistorySettings } from '@/composables/useHistorySettings'
import { HISTORY_PAGE_SIZE } from '@/features/settings/historyPages'
import { historySection } from '@/features/settings/historySection'
import type { SettingsSection } from '@/features/settings/settingsSections'
import { domainFrom } from '@/helpers/historyUrls'

const SECTION_ID = 'history'

export interface HistorySectionSource {
  /** The section, or undefined where there is nothing to offer and nothing kept to forget */
  section: ComputedRef<SettingsSection | undefined>
  /** Why the last change did not land, for the view to say above its list */
  error: Readonly<Ref<string | undefined>>
}

/**
 * Wires the history section to the account's history. Built where the instance offers history,
 * and where it no longer does but still keeps pages for this account, which stay reachable for
 * forgetting. Reads every kept page each time it is opened, since that list lives on the api and
 * is the one thing in settings that can have changed while the view was closed.
 * @param {() => string | undefined} expanded - Section whose rows are on screen
 * @returns {HistorySectionSource} - The section, and why the last change failed
 */
export function useHistorySection(expanded: () => string | undefined): HistorySectionSource {
  const { state } = useHistory(() => true)
  const { kept, keptStatus, loadKept, setPreferences, remove, clear } = useHistorySettings()

  const error = ref<string | undefined>()
  const shown = ref(HISTORY_PAGE_SIZE)

  const open = computed(() => expanded() === SECTION_ID)

  // Still listed while open once its pages were read and then all forgotten, so the row that
  // forgot them can say so rather than the section vanishing from under the caret.
  const listed = computed(
    () =>
      state.value.available ||
      state.value.kept > 0 ||
      (open.value && keptStatus.value !== 'unread'),
  )

  useHistoryDelivery(() => listed.value && open.value, loadKept)

  watch(
    () => listed.value && open.value,
    (reading) => {
      error.value = undefined
      shown.value = HISTORY_PAGE_SIZE

      if (reading) {
        void loadKept()
      }
    },
    { immediate: true },
  )

  /**
   * Runs one write, saying why it did not land unless the session lapsed, which the portal
   * already says once for every request.
   * @param {() => Promise<WriteOutcome>} send - The write
   * @param {string} failure - What to say when it is refused
   * @returns {Promise<boolean>} - Whether it landed
   */
  async function attempt(send: () => Promise<WriteOutcome>, failure: string): Promise<boolean> {
    error.value = undefined
    const outcome = await send()

    if (outcome === 'failed') {
      error.value = failure
    }

    return outcome === 'done'
  }

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

    if (state.value.excludedDomains.includes(domain)) {
      return `${domain} is already excluded`
    }

    const outcome = await setPreferences((current) => ({
      excludedDomains: [...new Set([...current.excludedDomains, domain])],
    }))

    // the field says why, the way a refused admin form does, rather than the line above the list
    return outcome === 'done' ? undefined : 'the portal did not take it, try again'
  }

  /**
   * Takes a domain off the excluded list. Nothing kept comes back: what excluding it forgot is gone.
   * @param {string} domain - Domain to record again
   * @returns {Promise<void>}
   */
  async function include(domain: string): Promise<void> {
    await attempt(
      () =>
        setPreferences((current) => ({
          excludedDomains: current.excludedDomains.filter((entry) => entry !== domain),
        })),
      `the portal did not stop excluding ${domain}, try again`,
    )
  }

  const section = computed(() => {
    if (!listed.value) {
      return undefined
    }

    return historySection({
      state: state.value,
      kept: kept.value,
      keptStatus: keptStatus.value,
      shown: shown.value,
      showMore: () => {
        shown.value += HISTORY_PAGE_SIZE
      },
      setEnabled: (enabled) =>
        void attempt(
          () => setPreferences(() => ({ enabled })),
          'the portal did not take the change, try again',
        ),
      exclude,
      include,
      remove: async (id) => {
        await attempt(() => remove(id), 'the portal did not forget that page, try again')
      },
      clear: async () => {
        await attempt(clear, 'the portal did not forget every page, try again')
      },
    })
  })

  return { section, error }
}
