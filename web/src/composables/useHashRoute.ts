import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef } from 'vue'

export interface PortalRoute {
  /**
   * `portal` is the launcher itself, `admin` the configuration view, `settings` the
   * preferences this browser holds, and `styleguide` the token reference that only exists
   * while developing.
   */
  readonly name: 'portal' | 'admin' | 'settings' | 'styleguide'
  /** Section expanded in the view, when the path names one */
  readonly section?: string
}

export interface HashRouteSource {
  route: ComputedRef<PortalRoute>
  isAdmin: ComputedRef<boolean>
  isSettings: ComputedRef<boolean>
  isStyleguide: ComputedRef<boolean>
  /** Section the route expands, or undefined for the bare list */
  section: ComputedRef<string | undefined>
  go: (path: string) => void
  /** Replaces the current entry rather than adding one, for a redirect */
  replace: (path: string) => void
}

// A hash rather than a path: the portal is one page, so this needs no server route, no SPA
// fallback and no history integration beyond what the browser already does. A handful of
// routes and a parameter do not earn a router dependency on a page that has to load as a
// new tab.
const hash = ref(readHash())

/**
 * Reads the current hash, normalised to a leading slash and without the `#`.
 * @returns {string} - Path such as `/admin/tiles`, or `/` when the hash is empty
 */
function readHash(): string {
  if (typeof window === 'undefined') {
    return '/'
  }

  const raw = window.location.hash.replace(/^#/, '')
  return raw.startsWith('/') ? raw : `/${raw}`
}

/**
 * Parses a path into the route it names. Anything unrecognised is the portal, so a stale or
 * hand-edited hash lands somewhere usable rather than on a blank page.
 * @param {string} path - Path taken from the hash
 * @returns {PortalRoute} - The route it names
 */
function parseRoute(path: string): PortalRoute {
  const [head, section] = path.split('/').filter(Boolean)

  // Only while developing, so a production build has no route here at all rather than one
  // that resolves to a view the bundle no longer contains.
  if (import.meta.env.DEV && head === 'styleguide') {
    return { name: 'styleguide' }
  }

  if (head !== 'admin' && head !== 'settings') {
    return { name: 'portal' }
  }

  return section ? { name: head, section } : { name: head }
}

let listeners = 0

/**
 * Exposes the current hash route and the two ways to change it.
 * @returns {HashRouteSource} - Reactive route and its controls
 */
export function useHashRoute(): HashRouteSource {
  /**
   * Syncs the ref with the address bar.
   * @returns {void}
   */
  function onHashChange(): void {
    hash.value = readHash()
  }

  // Read here, in setup, and not only on mount. The ref lives at module scope, so between the
  // last unmount and this call nothing was tracking the address bar — and a caller that decides
  // something from the route during setup, the way the settings view normalises an addressed
  // section, would otherwise decide it from whatever the previous view left behind.
  onHashChange()

  onMounted(() => {
    listeners += 1
    if (listeners === 1) {
      window.addEventListener('hashchange', onHashChange)
    }

    // the hash can still have changed between setup and mount, e.g. a link opened in place
    onHashChange()
  })

  onBeforeUnmount(() => {
    listeners -= 1
    if (listeners === 0) {
      window.removeEventListener('hashchange', onHashChange)
    }
  })

  const route = computed(() => parseRoute(hash.value))

  return {
    route,
    isAdmin: computed(() => route.value.name === 'admin'),
    isSettings: computed(() => route.value.name === 'settings'),
    isStyleguide: computed(() => route.value.name === 'styleguide'),
    section: computed(() => route.value.section),
    go: (path: string) => {
      window.location.hash = path
      hash.value = path
    },
    replace: (path: string) => {
      window.history.replaceState(null, '', `#${path}`)
      hash.value = path
    },
  }
}
