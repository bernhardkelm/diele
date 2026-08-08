import { computed, ref, shallowRef, type ComputedRef } from 'vue'
import { singleFlight } from '@/helpers/singleFlight'
import { ENTRIES_URL } from '@/config/api'
import { readEntriesCache, toEntriesPayload, writeEntriesCache } from '@/helpers/entriesCache'
import { toEntryTarget } from '@/helpers/entryTargets'
import type { ApiEntries, ApiEntriesSource, ApiHidden } from '@diele/common'
import type { PortalTarget, RowTarget } from '@/types/portal'

const EMPTY: ApiEntries = { entries: [], sources: [], hidden: { all: [], mine: [] } }

export interface ConnectorEntriesSource {
  /** Everything the connectors produced, seeded from the last visit until the fetch answers */
  targets: ComputedRef<ReadonlyArray<PortalTarget>>
  /** The subset drawn as list rows, which is what the repo section sorts and renders */
  rows: ComputedRef<ReadonlyArray<RowTarget>>
  /** One per enabled connector, carrying when it last synced and whether it is failing */
  sources: ComputedRef<ReadonlyArray<ApiEntriesSource>>
  /** True only while a load runs with nothing to show, so a cached list never blinks */
  isLoading: ComputedRef<boolean>
  /** True while a load runs behind a list that is already on screen */
  isRefreshing: ComputedRef<boolean>
  refresh: () => Promise<void>
}

// Shared at module scope, the way the config is: the entries are one document, and a second
// component asking for them must not mean a second request.
const payload = shallowRef<ApiEntries>(EMPTY)
const etag = ref<string | undefined>()
const isFetching = ref(false)

let hydrated = false

/**
 * Seeds the state from the last visit's cache, once.
 * @returns {void}
 */
function hydrate(): void {
  if (hydrated) {
    return
  }

  hydrated = true

  const cached = readEntriesCache()
  if (!cached) {
    return
  }

  payload.value = cached.payload
  etag.value = cached.etag
}

/**
 * Fetches the entries and replaces what is on screen, unless nothing changed. Every failure
 * path leaves the current list standing: what the last visit found is closer to the truth than
 * an empty section, and the API keeps its own copy for exactly the same reason.
 * @returns {Promise<void>}
 */
async function load(): Promise<void> {
  isFetching.value = true

  try {
    const response = await fetch(ENTRIES_URL, {
      headers: {
        accept: 'application/json',
        ...(etag.value ? { 'if-none-match': etag.value } : {}),
      },
    })

    if (response.status === 304) {
      return
    }

    if (!response.ok) {
      throw new Error(`entries responded ${response.status}`)
    }

    const next = toEntriesPayload(await response.json())
    if (!next) {
      throw new Error('entries payload was not one')
    }

    payload.value = next
    etag.value = response.headers.get('etag') ?? undefined
    writeEntriesCache(next, response.headers.get('etag'))
  } catch (error) {
    console.warn('[diele] connector entries unavailable, keeping the cached ones:', error)
  } finally {
    isFetching.value = false
  }
}

/** Loads the entries once per page, no matter how many components ask for them. */
const ensureLoaded = singleFlight(load)

/**
 * Fetches the entries again, for a caller outside the component tree.
 *
 * Signing in with a password needs this: the session changes without the page reloading, so
 * nothing would otherwise retry the request that returned 401 a moment earlier.
 * @returns {Promise<void>}
 */
export function refreshConnectorEntries(): Promise<void> {
  return ensureLoaded()
}

/**
 * Drops everything held in memory, so the next reader hydrates from storage again.
 * @returns {void}
 */
export function resetConnectorEntries(): void {
  payload.value = EMPTY
  etag.value = undefined
  hydrated = false
  ensureLoaded.reset()
}

const targets = computed<ReadonlyArray<PortalTarget>>(() =>
  payload.value.entries.map(toEntryTarget),
)
/** What is kept out of the list, read where the entries themselves are. */
export const hiddenRefs = computed<ApiHidden>(() => payload.value.hidden)

const rows = computed<ReadonlyArray<RowTarget>>(
  () => targets.value.filter((target) => target.kind === 'row') as ReadonlyArray<RowTarget>,
)

/**
 * Exposes what the connectors produced: repos, groups and whatever a later connector adds.
 * Painted from the last visit's cache immediately and revalidated behind it, so opening a new
 * tab never waits on the API, which in turn never waits on the source.
 * @returns {ConnectorEntriesSource} - Reactive entries and their controls
 */
export function useConnectorEntries(): ConnectorEntriesSource {
  hydrate()
  void ensureLoaded()

  return {
    targets,
    rows,
    sources: computed(() => payload.value.sources),
    isLoading: computed(() => isFetching.value && payload.value.entries.length === 0),
    isRefreshing: computed(() => isFetching.value && payload.value.entries.length > 0),
    refresh: () => ensureLoaded(),
  }
}
