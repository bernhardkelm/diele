import { ref } from 'vue'
import { pushRecent } from '@/helpers/recentList'
import { LAUNCH_HISTORY_KEY } from '@/config/api'
import { isMadeUpRef } from '@/features/portal/dynamicTarget'
import { readStringList, writeJson } from '@/helpers/storage'

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
 * Returns whether a ref is one worth keeping: an opaque id rather than one built from a url.
 *
 * A target made up from the term carries that term's url in its ref, query and fragment included.
 * It only exists while that exact term is typed, so a boost for it buys nothing, and keeping it
 * would leave typed addresses in the browser whatever the account chose about its history.
 * @param {string} entryRef - Ref to test
 * @returns {boolean} - True for a ref that names a stored target
 */
function isKept(entryRef: string): boolean {
  return entryRef.length > 0 && !isMadeUpRef(entryRef)
}

/**
 * Reads the stored history, leaving out anything an older build wrote that is no longer kept, and
 * writing the list back without it so what was left out does not stay in storage either.
 * @returns {string[]} - Refs, newest first, capped
 */
function readRefs(): string[] {
  const stored = readStringList(LAUNCH_HISTORY_KEY)
  const kept = stored.filter(isKept)

  if (kept.length !== stored.length) {
    writeJson(LAUNCH_HISTORY_KEY, kept.slice(0, LIMIT))
  }

  return kept.slice(0, LIMIT)
}

/**
 * Tracks which targets actually get opened, so the ones you reach for keep winning ties. The
 * bonus is small enough that a weak match never overtakes a strong one on habit alone.
 * @returns {LaunchHistory} - Reader and recorder over the stored history
 */
export function useLaunchHistory(): LaunchHistory {
  // newest first, so the cap drops the oldest
  const refs = ref<string[]>(readRefs())

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
   * Records that a target was opened, moving it to the front of the history. Built on what is
   * stored rather than on what this reader loaded, so a list cleared by signing out is not
   * written back from memory.
   * @param {string} entryRef - Stable identity of what was opened
   * @returns {void}
   */
  function remember(entryRef: string): void {
    if (!isKept(entryRef)) {
      return
    }

    refs.value = [...pushRecent(readRefs(), entryRef, LIMIT)]
    writeJson(LAUNCH_HISTORY_KEY, refs.value)
  }

  return { boostFor, remember }
}
