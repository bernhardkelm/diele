import { computed, type ComputedRef } from 'vue'
import { reportLapse } from '@/composables/sessionLapse'
import {
  historyEntries,
  historyState,
  isStale,
  keptEntries,
  keptStatus,
  markRead,
  toState,
  type KeptStatus,
} from '@/composables/historyState'
import { sendHistoryWrite, type WriteOutcome } from '@/composables/historyWrite'
import { rereadHistory } from '@/composables/useHistory'
import { HISTORY_ENTRIES_URL, HISTORY_PREFERENCES_URL, historyEntryUrl } from '@/config/api'
import type { ApiHistoryEntry, ApiHistoryPreferences, ApiHistoryState } from '@diele/common'

export interface HistorySettings {
  /** What the instance offers and what this account chose, all off until the api says otherwise */
  state: ComputedRef<ApiHistoryState>
  /** Every page kept for this account, most recent first, once `loadKept` has read them */
  kept: ComputedRef<ReadonlyArray<ApiHistoryEntry>>
  keptStatus: ComputedRef<KeptStatus>
  /** Reads every kept page, for the settings list */
  loadKept: () => Promise<void>
  /** Forgets one page */
  remove: (id: number) => Promise<WriteOutcome>
  /** Forgets every page */
  clear: () => Promise<WriteOutcome>
  /**
   * Changes the opt-in or the excluded domains, one change at a time, each built from the state
   * the change before it left
   */
  setPreferences: (
    change: (current: ApiHistoryState) => ApiHistoryPreferences,
  ) => Promise<WriteOutcome>
}

// Kept reads on their way, and whether one was dropped, so a write that outdated one knows to read
// the list again.
let keptReads = 0
let keptDropped = false
// The last preference change queued, which the next one waits for.
let preferenceQueue: Promise<unknown> = Promise.resolve()

/**
 * Reads every kept page for the settings list. An answer sent before a write or a sign-out is
 * dropped, and whatever outdated it reads the list again.
 * @returns {Promise<void>}
 */
async function loadKept(): Promise<void> {
  const mark = markRead()
  keptReads += 1

  // a list already on screen stays there while it is read again, rather than blinking out
  if (keptStatus.value !== 'read') {
    keptStatus.value = 'reading'
  }

  try {
    const response = await fetch(HISTORY_ENTRIES_URL, { headers: { accept: 'application/json' } })

    if (!response.ok) {
      reportLapse(response.status)
      throw new Error(`history entries responded ${response.status}`)
    }

    const payload = (await response.json()) as { entries?: ReadonlyArray<ApiHistoryEntry> }

    if (isStale(mark)) {
      keptDropped = true
      return
    }

    keptEntries.value = Array.isArray(payload.entries) ? payload.entries : []
    keptStatus.value = 'read'
  } catch (error) {
    console.warn('[diele] kept history unavailable:', error)

    if (isStale(mark)) {
      keptDropped = true
    } else {
      keptStatus.value = 'failed'
    }
  } finally {
    keptReads -= 1
  }
}

/**
 * Reads again whatever a write may have changed or outdated, refused writes included, since they
 * outdate the reads on their way all the same: the search slice and the state always, in a request
 * of their own, and the kept pages where asked to or where a read of them was outdated. A delete
 * reads them again only in that last case: the list itself is already right, and reading every
 * kept page again on each one would cost far more than the delete.
 * @param {boolean} kept - Whether the kept pages need reading again whatever else is on its way
 * @returns {Promise<void>}
 */
async function rereadAfterWrite(kept: boolean): Promise<void> {
  const keptAgain = keptStatus.value !== 'unread' && (kept || keptReads > 0 || keptDropped)
  keptDropped = false

  await Promise.all([rereadHistory(), keptAgain ? loadKept() : undefined])
}

/**
 * Forgets one page, on the api and then at once in the settings list and the search.
 * @param {number} id - Entry to delete
 * @returns {Promise<WriteOutcome>} - How the delete ended
 */
async function remove(id: number): Promise<WriteOutcome> {
  const { outcome, current } = await sendHistoryWrite(historyEntryUrl(id), { method: 'DELETE' })

  if (!current) {
    return outcome
  }

  if (outcome === 'done') {
    keptEntries.value = keptEntries.value.filter((entry) => entry.id !== id)
    historyEntries.value = historyEntries.value.filter((entry) => entry.id !== id)
  }

  await rereadAfterWrite(false)

  return outcome
}

/**
 * Forgets every page kept for this account.
 * @returns {Promise<WriteOutcome>} - How the delete ended
 */
async function clear(): Promise<WriteOutcome> {
  const { outcome, current } = await sendHistoryWrite(HISTORY_ENTRIES_URL, { method: 'DELETE' })

  if (!current) {
    return outcome
  }

  if (outcome === 'done') {
    keptEntries.value = []
    historyEntries.value = []
    historyState.value = { ...historyState.value, kept: 0 }

    if (keptStatus.value !== 'unread') {
      keptStatus.value = 'read'
    }
  }

  await rereadAfterWrite(false)

  return outcome
}

/**
 * Sends one preference change, built from the state as it stands once the change before it has
 * answered. Both lists are read again afterwards, because excluding a domain also deletes what was
 * kept on it, which only the api knows the extent of.
 * @param {(current: ApiHistoryState) => ApiHistoryPreferences} change - Builds the fields to send; a field left out stays as it is
 * @returns {Promise<WriteOutcome>} - How the write ended
 */
async function sendPreferences(
  change: (current: ApiHistoryState) => ApiHistoryPreferences,
): Promise<WriteOutcome> {
  const { outcome, response, current } = await sendHistoryWrite(HISTORY_PREFERENCES_URL, {
    method: 'PUT',
    body: JSON.stringify(change(historyState.value)),
  })

  if (!current) {
    return outcome
  }

  if (outcome === 'done') {
    try {
      historyState.value = toState((await response?.json()) as Partial<ApiHistoryState>)
    } catch {
      // the write landed either way, and the read below brings the state back with it
    }
  }

  await rereadAfterWrite(outcome === 'done')

  return outcome
}

/**
 * Queues a preference change behind the one before it, so two changes made in quick succession
 * cannot each send a domain list the other has not seen.
 * @param {(current: ApiHistoryState) => ApiHistoryPreferences} change - Builds the fields to send
 * @returns {Promise<WriteOutcome>} - How the write ended
 */
function setPreferences(
  change: (current: ApiHistoryState) => ApiHistoryPreferences,
): Promise<WriteOutcome> {
  const queued = preferenceQueue.then(() => sendPreferences(change))
  preferenceQueue = queued

  return queued
}

/**
 * Exposes every page kept for this account and the controls over them, for the settings.
 * @returns {HistorySettings} - State, kept pages and the writes that change them
 */
export function useHistorySettings(): HistorySettings {
  return {
    state: computed(() => historyState.value),
    kept: computed(() => keptEntries.value),
    keptStatus: computed(() => keptStatus.value),
    loadKept,
    remove,
    clear,
    setPreferences,
  }
}
