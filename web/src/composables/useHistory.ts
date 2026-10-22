import { computed, watch, type ComputedRef } from 'vue'
import { reportLapse } from '@/composables/sessionLapse'
import { postHistory } from '@/composables/historyWrite'
import {
  historyEntries,
  historyState,
  isStale,
  markRead,
  resetHistoryState,
  toState,
} from '@/composables/historyState'
import { HISTORY_URL, HISTORY_VISITS_URL } from '@/config/api'
import { isExcludedHost } from '@/helpers/historyUrls'
import { singleFlight } from '@/helpers/singleFlight'
import type { ApiHistory, ApiHistoryEntry, ApiHistoryState, ApiHistoryVisits } from '@diele/common'

export interface HistorySource {
  /** What the instance offers and what this account chose, all off until the api says otherwise */
  state: ComputedRef<ApiHistoryState>
  /** The most frecent pages, already deduplicated by the api, for the search */
  entries: ComputedRef<ReadonlyArray<ApiHistoryEntry>>
  /** Reports one page opened from the portal, when every switch on the way allows it */
  recordVisit: (url: string) => void
}

let requested = false

/**
 * Reads the search slice and the state. The api serves the state whatever the switches say, and
 * an empty slice wherever they keep the search from offering anything, so only a lapse or a
 * failure leaves nothing to read; neither leaves anything worth keeping on screen from before it.
 *
 * An answer sent before a write or a sign-out is dropped: it may carry a page just forgotten, or
 * the previous account's.
 * @returns {Promise<void>}
 */
async function load(): Promise<void> {
  const mark = markRead()

  try {
    const response = await fetch(HISTORY_URL, { headers: { accept: 'application/json' } })
    const payload = response.ok ? ((await response.json()) as Partial<ApiHistory>) : undefined

    if (isStale(mark)) {
      return
    }

    if (!payload) {
      reportLapse(response.status)
      historyEntries.value = []
      return
    }

    historyState.value = toState(payload.state)
    historyEntries.value = Array.isArray(payload.entries) ? payload.entries : []
  } catch (error) {
    console.warn('[diele] history unavailable:', error)

    if (!isStale(mark)) {
      historyEntries.value = []
    }
  }
}

const refresh = singleFlight(load)

/**
 * Reports one page opened from the portal. Only while the instance offers history, accepts
 * visits from diele and this account opted in, and never for a domain it excluded: the api
 * refuses all of those too, but a page that would be refused is better never sent. No title,
 * since the api keeps none for a visit from diele.
 *
 * `keepalive`, because opening the page unloads this one straight after, which would otherwise
 * cancel the request on its way out.
 * @param {string} url - Address that was opened
 * @returns {void}
 */
function recordVisit(url: string): void {
  const current = historyState.value
  if (!current.available || !current.sources.diele || !current.enabled) {
    return
  }

  if (isExcludedHost(url, current.excludedDomains)) {
    return
  }

  const body: ApiHistoryVisits = {
    source: 'diele',
    visits: [{ url, at: new Date().toISOString() }],
  }

  void postHistory(HISTORY_VISITS_URL, {
    method: 'POST',
    keepalive: true,
    body: JSON.stringify(body),
  })
}

/**
 * Exposes the pages this account visited, for the search.
 *
 * Read once per page load, the first time a caller says its view is on screen, and again after
 * each of the account's own changes. Never polled: the extension says when it delivered visits,
 * and `useHistoryDelivery` reads again on that word alone.
 * @param {() => boolean} [enabled] - Whether the view reading it is on screen; left out by a caller that only writes
 * @returns {HistorySource} - State, entries and the report of a visit
 */
export function useHistory(enabled?: () => boolean): HistorySource {
  if (enabled) {
    watch(
      enabled,
      (on) => {
        if (on && !requested) {
          requested = true
          void refresh()
        }
      },
      { immediate: true },
    )
  }

  return {
    state: computed(() => historyState.value),
    entries: computed(() => historyEntries.value),
    recordVisit,
  }
}

/**
 * Reads the search slice again, for a caller outside the component tree. Only once something has
 * asked for it: signing in with a password changes the session without reloading the page, and a
 * read that answered 401 a moment earlier would otherwise stay empty.
 * @returns {Promise<void>}
 */
export function refreshHistory(): Promise<void> {
  return requested ? refresh() : Promise.resolve()
}

/**
 * Reads the search slice in a request of its own, never joining one already on its way: after a
 * write, that one was sent before it and its answer is dropped.
 * @returns {Promise<void>}
 */
export function rereadHistory(): Promise<void> {
  if (!requested) {
    return Promise.resolve()
  }

  refresh.reset()

  return refresh()
}

/**
 * Drops everything held, so the next reader starts from nothing, and every answer still on its
 * way with it. Signing out needs it: the next account to sign in on this page must not be offered
 * where the last one went.
 * @returns {void}
 */
export function resetHistory(): void {
  resetHistoryState()
  requested = false
  refresh.reset()
}
