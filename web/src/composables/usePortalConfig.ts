import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue'
import { singleFlight } from '@/helpers/singleFlight'
import { CONFIG_URL } from '@/config/api'
import { readConfigCache, writeConfigCache } from '@/helpers/configCache'
import { applyBrandAccent } from '@/helpers/brandAccent'
import { EMPTY_CONFIG, toPortalConfig, type PortalConfig } from '@/helpers/portalConfig'
import type { ApiBrand, ApiCommand, ApiConfig } from '@diele/common'
import type { CardTarget, SearchEngine, SuggestionTarget } from '@/types/portal'

/**
 * `cold` is the only state that has nothing to paint: every later visit starts from the
 * cache, so a stale config and a fresh one look the same to the page.
 */
export type ConfigState = 'cold' | 'ready' | 'needs-auth' | 'unreachable'

export interface PortalConfigSource {
  brand: ComputedRef<ApiBrand>
  cards: ComputedRef<ReadonlyArray<CardTarget>>
  sites: ComputedRef<ReadonlyArray<SuggestionTarget>>
  engines: ComputedRef<ReadonlyArray<SearchEngine>>
  commands: ComputedRef<ReadonlyArray<ApiCommand>>
  settings: ComputedRef<Record<string, unknown>>
  state: Ref<ConfigState>
  /** True once anything has been painted, from cache or from the network */
  hasConfig: ComputedRef<boolean>
  /** Refetches after a write, called as `usePortalConfig().refresh()` rather than destructured */
  refresh: () => Promise<void>
}

// Shared at module scope: the config is one document, and a second component asking for it
// must not mean a second request.
const config = shallowRef<PortalConfig>(EMPTY_CONFIG)
const etag = ref<string | undefined>()
const state = ref<ConfigState>('cold')

let hydrated = false
let fromCache = false

/**
 * Seeds the state from the last visit's cache, once. Lazy rather than done at import time so
 * the read happens when the app actually asks, which is still before the first paint.
 * @returns {void}
 */
function hydrate(): void {
  if (hydrated) {
    return
  }

  hydrated = true

  const cached = readConfigCache()
  if (!cached) {
    return
  }

  config.value = toPortalConfig(cached.config)
  applyBrandAccent(config.value.brand)
  etag.value = cached.etag
  state.value = 'ready'
  fromCache = true
}

/**
 * Fetches the configuration and replaces what is on screen, unless nothing changed. A
 * failure deliberately leaves the cached config in place: a portal showing a slightly old
 * tile list beats a portal showing nothing because revalidation timed out.
 * @returns {Promise<void>}
 */
async function load(): Promise<void> {
  try {
    const response = await fetch(CONFIG_URL, {
      headers: {
        accept: 'application/json',
        ...(etag.value ? { 'if-none-match': etag.value } : {}),
      },
    })

    if (response.status === 304) {
      state.value = 'ready'
      return
    }

    if (response.status === 401) {
      // Not an error: the session simply lapsed. Whether that interrupts the user is App's
      // call, and it only does when there is no cached config to fall back on.
      state.value = 'needs-auth'
      return
    }

    if (!response.ok) {
      throw new Error(`config responded ${response.status}`)
    }

    const payload = (await response.json()) as ApiConfig
    config.value = toPortalConfig(payload)
    applyBrandAccent(config.value.brand)
    etag.value = response.headers.get('etag') ?? undefined
    state.value = 'ready'
    writeConfigCache(payload, response.headers.get('etag'))
  } catch (error) {
    console.warn('[diele] config unavailable, keeping the cached one:', error)
    state.value = fromCache ? 'ready' : 'unreachable'
  }
}

/** Loads the configuration once per page, no matter how many components ask for it. */
const ensureLoaded = singleFlight(load)

/**
 * Fetches the configuration again, for a caller outside the component tree.
 *
 * Signing in with a password needs this: the session changes without the page reloading, so
 * nothing would otherwise retry the request that returned 401 a moment earlier.
 * @returns {Promise<void>}
 */
export function refreshPortalConfig(): Promise<void> {
  return ensureLoaded()
}

/**
 * Drops everything held in memory, so the next reader hydrates from storage again. Signing
 * out uses it to make sure the next visitor to this browser does not inherit the last one's
 * portal from a ref that outlived their session.
 * @returns {void}
 */
export function resetPortalConfig(): void {
  config.value = EMPTY_CONFIG
  etag.value = undefined
  state.value = 'cold'
  hydrated = false
  fromCache = false
  ensureLoaded.reset()
}

/**
 * Exposes the portal's configuration: the cards, saved sites and search engines that used to
 * be source files. Painted from the last visit's cache immediately and revalidated behind it,
 * so opening a new tab never waits on the API.
 * @returns {PortalConfigSource} - Reactive configuration and its controls
 */
export function usePortalConfig(): PortalConfigSource {
  hydrate()
  void ensureLoaded()

  return {
    brand: computed(() => config.value.brand),
    cards: computed(() => config.value.cards),
    sites: computed(() => config.value.sites),
    engines: computed(() => config.value.engines),
    commands: computed(() => config.value.commands),
    settings: computed(() => config.value.settings),
    state,
    hasConfig: computed(() => config.value.cards.length > 0 || config.value.sites.length > 0),
    refresh: () => ensureLoaded(),
  }
}
