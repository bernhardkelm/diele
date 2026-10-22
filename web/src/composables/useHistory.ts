import { computed, shallowRef, watch, type ComputedRef } from 'vue'
import { reportLapse } from '@/composables/sessionLapse'
import {
  HISTORY_ENTRIES_URL,
  HISTORY_PREFERENCES_URL,
  HISTORY_URL,
  HISTORY_VISITS_URL,
  historyEntryUrl,
} from '@/config/api'
import { isExcludedHost } from '@/helpers/historyUrls'
import { singleFlight } from '@/helpers/singleFlight'
import type {
  ApiHistory,
  ApiHistoryEntry,
  ApiHistoryPreferences,
  ApiHistoryState,
  ApiHistoryVisits,
} from '@diele/common'

/** Where the settings list stands: not asked for yet, on its way, on screen, or refused. */
export type KeptStatus = 'unread' | 'reading' | 'read' | 'failed'

const OFF: ApiHistoryState = {
  available: false,
  sources: { diele: false, extension: false },
  enabled: false,
  excludedDomains: [],
}

const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' }

export interface HistorySource {
  /** What the instance offers and what this account chose, all off until the api says otherwise */
  state: ComputedRef<ApiHistoryState>
  /** The most frecent pages, already deduplicated by the api, for the search */
  entries: ComputedRef<ReadonlyArray<ApiHistoryEntry>>
  /** Every page kept for this account, most recent first, once `loadKept` has read them */
  kept: ComputedRef<ReadonlyArray<ApiHistoryEntry>>
  keptStatus: ComputedRef<KeptStatus>
  /** Reads every kept page, for the settings list */
  loadKept: () => Promise<void>
  /** Reports one page opened from the portal, when every switch on the way allows it */
  recordVisit: (url: string, title?: string) => void
  /** Forgets one page, returning whether the api did */
  remove: (id: number) => Promise<boolean>
  /** Forgets every page, returning whether the api did */
  clear: () => Promise<boolean>
  /** Changes the opt-in or the excluded domains, returning whether the api took it */
  setPreferences: (preferences: ApiHistoryPreferences) => Promise<boolean>
}

// Shared at module scope the way the entries are: one document however many views read it. Held
// in memory only, never in storage: where someone has been is not something to leave in the
// browser for whoever opens it next.
const state = shallowRef<ApiHistoryState>(OFF)
const entries = shallowRef<ReadonlyArray<ApiHistoryEntry>>([])
const kept = shallowRef<ReadonlyArray<ApiHistoryEntry>>([])
const keptStatus = shallowRef<KeptStatus>('unread')

let requested = false

/**
 * Reads a state the api served, filling in whatever an older api left out rather than trusting it.
 * @param {Partial<ApiHistoryState> | undefined} served - State as it arrived
 * @returns {ApiHistoryState} - A complete state, off wherever it said nothing
 */
function toState(served: Partial<ApiHistoryState> | undefined): ApiHistoryState {
  return {
    available: served?.available === true,
    sources: { ...OFF.sources, ...served?.sources },
    enabled: served?.enabled === true,
    excludedDomains: served?.excludedDomains ?? [],
  }
}

/**
 * Reads the search slice and the state. A refusal or a failure leaves the list empty: a 403 is the
 * feature or the opt-in being off, and there is nothing worth keeping on screen from before it.
 * @returns {Promise<void>}
 */
async function load(): Promise<void> {
  try {
    const response = await fetch(HISTORY_URL, { headers: { accept: 'application/json' } })

    if (!response.ok) {
      reportLapse(response.status)
      entries.value = []
      return
    }

    const payload = (await response.json()) as Partial<ApiHistory>
    state.value = toState(payload.state)
    entries.value = Array.isArray(payload.entries) ? payload.entries : []
  } catch (error) {
    console.warn('[diele] history unavailable:', error)
    entries.value = []
  }
}

const refresh = singleFlight(load)

/**
 * Reads every kept page for the settings list.
 * @returns {Promise<void>}
 */
async function loadKept(): Promise<void> {
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
    kept.value = Array.isArray(payload.entries) ? payload.entries : []
    keptStatus.value = 'read'
  } catch (error) {
    console.warn('[diele] kept history unavailable:', error)
    keptStatus.value = 'failed'
  }
}

/**
 * Sends one write and reports whether it landed, a lapsed session included.
 * @param {string} url - Endpoint to write to
 * @param {RequestInit} init - Method and body
 * @returns {Promise<Response | undefined>} - The answer when it was a success, otherwise undefined
 */
async function write(url: string, init: RequestInit): Promise<Response | undefined> {
  try {
    const response = await fetch(url, { headers: JSON_HEADERS, ...init })

    if (response.ok) {
      return response
    }

    reportLapse(response.status)
    console.warn(`[diele] ${init.method} ${url} answered ${response.status}`)
  } catch (error) {
    console.warn(`[diele] ${init.method} ${url} failed:`, error)
  }

  return undefined
}

/**
 * Reports one page opened from the portal. Only while the instance offers history, accepts
 * visits from diele and this account opted in, and never for a domain it excluded: the api
 * refuses all of those too, but a page that would be refused is better never sent.
 *
 * `keepalive`, because opening the page unloads this one straight after, which would otherwise
 * cancel the request on its way out.
 * @param {string} url - Address that was opened
 * @param {string} [title] - The page's own title, where the portal knows one
 * @returns {void}
 */
function recordVisit(url: string, title?: string): void {
  const current = state.value
  if (!current.available || !current.sources.diele || !current.enabled) {
    return
  }

  if (isExcludedHost(url, current.excludedDomains)) {
    return
  }

  const body: ApiHistoryVisits = {
    source: 'diele',
    visits: [{ url, ...(title ? { title } : {}), at: new Date().toISOString() }],
  }

  void write(HISTORY_VISITS_URL, { method: 'POST', keepalive: true, body: JSON.stringify(body) })
}

/**
 * Forgets one page, in the settings list at once and in the search once the slice is read again.
 * @param {number} id - Entry to delete
 * @returns {Promise<boolean>} - Whether the api deleted it
 */
async function remove(id: number): Promise<boolean> {
  const done = await write(historyEntryUrl(id), { method: 'DELETE' })

  if (done) {
    kept.value = kept.value.filter((entry) => entry.id !== id)
    entries.value = entries.value.filter((entry) => entry.id !== id)
    await refresh()
  }

  return done !== undefined
}

/**
 * Forgets every page kept for this account.
 * @returns {Promise<boolean>} - Whether the api cleared them
 */
async function clear(): Promise<boolean> {
  const done = await write(HISTORY_ENTRIES_URL, { method: 'DELETE' })

  if (done) {
    kept.value = []
    entries.value = []
  }

  return done !== undefined
}

/**
 * Changes the opt-in or the excluded domains. Both lists are read again afterwards, because
 * excluding a domain also deletes what was kept on it, which only the api knows the extent of.
 * @param {ApiHistoryPreferences} preferences - Fields to change; a field left out stays as it is
 * @returns {Promise<boolean>} - Whether the api took it
 */
async function setPreferences(preferences: ApiHistoryPreferences): Promise<boolean> {
  const done = await write(HISTORY_PREFERENCES_URL, {
    method: 'PUT',
    body: JSON.stringify(preferences),
  })

  if (!done) {
    return false
  }

  try {
    state.value = toState((await done.json()) as Partial<ApiHistoryState>)
  } catch {
    // the write landed either way, and the read below brings the state back with it
  }

  await Promise.all([refresh(), keptStatus.value === 'unread' ? undefined : loadKept()])

  return true
}

/**
 * Exposes the pages this account visited and the controls over them.
 *
 * Read once per page load, the first time a caller says its view is on screen, and again after
 * each of the account's own changes. Never polled: nothing else adds to it while this page is open.
 * @param {() => boolean} [enabled] - Whether the view reading it is on screen; left out by a caller that only writes
 * @returns {HistorySource} - State, entries and the writes that change them
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
    state: computed(() => state.value),
    entries: computed(() => entries.value),
    kept: computed(() => kept.value),
    keptStatus: computed(() => keptStatus.value),
    loadKept,
    recordVisit,
    remove,
    clear,
    setPreferences,
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
 * Drops everything held, so the next reader starts from nothing. Signing out needs it: the next
 * account to sign in on this page must not be offered where the last one went.
 * @returns {void}
 */
export function resetHistory(): void {
  state.value = OFF
  entries.value = []
  kept.value = []
  keptStatus.value = 'unread'
  requested = false
  refresh.reset()
}
