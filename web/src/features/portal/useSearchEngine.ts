import { computed, ref, type ComputedRef } from 'vue'
import type { SearchEngine } from '@/types/portal'

export interface SearchEngineSelection {
  /** Undefined only while the configuration has not produced any engine yet */
  engine: ComputedRef<SearchEngine | undefined>
  /** Moves to the next engine, wrapping; negative steps backwards */
  cycle: (delta?: number) => void
  /** Builds the query url for the active engine, or undefined when there is none */
  urlFor: (query: string) => string | undefined
}

/**
 * Holds which search engine the bar submits to. The choice lasts for the visit only: every
 * page load starts back at the first engine, so the default is always what Enter does.
 * @param {() => ReadonlyArray<SearchEngine>} engines - Configured engines, read on access so a later load is picked up
 * @returns {SearchEngineSelection} - Reactive engine choice and its controls
 */
export function useSearchEngine(engines: () => ReadonlyArray<SearchEngine>): SearchEngineSelection {
  const index = ref(0)

  const engine = computed(() => {
    const all = engines()
    return all[index.value] ?? all[0]
  })

  /**
   * Selects another engine, wrapping past either end.
   * @param {number} delta - Engines to move by, negative to go back
   * @returns {void}
   */
  function cycle(delta = 1): void {
    const count = engines().length
    if (count === 0) {
      return
    }

    index.value = (index.value + delta + count) % count
  }

  /**
   * Builds the url that searches the active engine for a term.
   * @param {string} query - Raw search term
   * @returns {string | undefined} - Absolute url to navigate to, or undefined without an engine
   */
  function urlFor(query: string): string | undefined {
    const active = engine.value
    if (!active) {
      return undefined
    }

    return active.urlTemplate.replace('{query}', encodeURIComponent(query.trim()))
  }

  return { engine, cycle, urlFor }
}
