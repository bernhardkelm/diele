import { ref } from 'vue'
import { pushRecent } from '@/helpers/recentList'
import { readStringList, writeJson } from '@/helpers/storage'

// Keyed by ref rather than by url, which is why the key is versioned: renaming a repo changes
// its url, and a history keyed on that would quietly forget everything ever opened from it.
const STORAGE_KEY = 'diele:launch-history:v2'
/** Entries kept; past this the oldest fall off */
const LIMIT = 30
/** Score the most recent entry gains, decaying to nothing across the rest of the list */
const MAX_BOOST = 120

export interface LaunchHistory {
  /** Extra score a target has earned by being opened before, 0 for one that never was */
  boostFor: (ref: string) => number
  /** Records that a target was opened, moving it to the front */
  remember: (ref: string) => void
}

/**
 * Tracks which targets actually get opened, so the ones you reach for keep winning ties. The
 * bonus is small enough that a weak match never overtakes a strong one on habit alone.
 * @returns {LaunchHistory} - Reader and recorder over the stored history
 */
export function useLaunchHistory(): LaunchHistory {
  // newest first, so the cap drops the oldest
  const refs = ref<string[]>(readStringList(STORAGE_KEY).slice(0, LIMIT))

  /**
   * Returns the score bonus a target has earned, decaying with how long ago it was opened.
   * @param {string} entryRef - Stable identity of the target being ranked
   * @returns {number} - Bonus, 0 for a target that is not in the history
   */
  function boostFor(entryRef: string): number {
    const position = entryRef ? refs.value.indexOf(entryRef) : -1

    return position === -1 ? 0 : Math.round(MAX_BOOST * (1 - position / LIMIT))
  }

  /**
   * Records that a target was opened, moving it to the front of the history.
   * @param {string} entryRef - Stable identity of what was opened
   * @returns {void}
   */
  function remember(entryRef: string): void {
    if (!entryRef) {
      return
    }

    refs.value = [...pushRecent(refs.value, entryRef, LIMIT)]
    writeJson(STORAGE_KEY, refs.value)
  }

  return { boostFor, remember }
}
