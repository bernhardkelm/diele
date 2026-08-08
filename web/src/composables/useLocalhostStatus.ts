import { onMounted, ref } from 'vue'
import { useVisibilityChange } from '@/composables/useVisibilityChange'
import type { SuggestionTarget } from '@/types/portal'
import { isLocalhostUrl } from '@/helpers/localhost'

// A loopback connection either answers at once or is refused at once, so a short budget is
// enough and keeps a stalled port from holding the row in limbo.
const PROBE_TIMEOUT_MS = 1_500

export interface LocalhostStatus {
  isLive: (site: SuggestionTarget) => boolean
}

/**
 * Probes one local url.
 * `no-cors` is what makes this possible without the dev server opting in: the response is
 * opaque and unreadable, but a refused connection still rejects, and reaching the port at
 * all is the whole question.
 * @param {string} url - Local url to probe
 * @returns {Promise<boolean>} - True when something answered
 */
async function probe(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return true
  } catch {
    return false
  }
}

/**
 * Tracks which of the saved localhost entries currently have a server listening. Only the
 * reachable ones are reported: a probe can fail because nothing is running, but equally
 * because a browser refused the request, and marking every port red on that basis would be
 * worse than saying nothing. Re-probes whenever the tab is brought back to the front, which
 * is exactly when a dev server has just been started elsewhere.
 * @param {() => ReadonlyArray<SuggestionTarget>} sites - Saved sites, read on each probe; the non-local ones are ignored
 * @returns {LocalhostStatus} - Reactive liveness and its controls
 */
export function useLocalhostStatus(sites: () => ReadonlyArray<SuggestionTarget>): LocalhostStatus {
  const live = ref<ReadonlySet<string>>(new Set())

  /**
   * Probes every local entry and rebuilds the live set.
   * @returns {Promise<void>}
   */
  async function refresh(): Promise<void> {
    const local = sites().filter((site) => isLocalhostUrl(site.url))
    if (local.length === 0) {
      return
    }

    const results = await Promise.all(local.map((site) => probe(site.url)))
    live.value = new Set(local.filter((_, index) => results[index]).map((site) => site.ref))
  }

  /**
   * Returns whether a site had a server listening at the last probe.
   * @param {SuggestionTarget} site - Site to look up
   * @returns {boolean} - True when the port answered
   */
  function isLive(site: SuggestionTarget): boolean {
    return live.value.has(site.ref)
  }

  // a port that was down may be up by the time the tab comes back
  useVisibilityChange((hidden) => {
    if (!hidden) {
      void refresh()
    }
  })

  onMounted(() => {
    void refresh()
  })

  return { isLive }
}
