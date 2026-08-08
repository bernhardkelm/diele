import { ref } from 'vue'
import { pushRecent } from '@/helpers/recentList'
import { readStringList, writeJson } from '@/helpers/storage'

/** localStorage key holding the base urls that were opened, newest first. */
const STORAGE_KEY = 'diele:visited-urls'
/** Entries kept; past this the oldest fall off */
const LIMIT = 100

export interface VisitedUrls {
  /** Records that a url was opened, keeping its base and moving it to the end */
  remember: (url: string) => void
}

/**
 * Reduces a url to the part worth saving as a site: scheme, host and port, without the path
 * it happened to be reached through.
 * @param {string} url - Absolute url that was opened
 * @returns {string} - Base url, empty when the url cannot be parsed
 */
function baseOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * Collects the hosts reached by typing a url into the field rather than by picking something
 * the portal already knows, so a host that keeps coming up can later be lifted out of the
 * list and seeded into the saved sites. Only the base url is kept, and a host already in the
 * list moves to the end rather than appearing twice.
 * @returns {VisitedUrls} - Reactive list of visited base urls and its recorder
 */
export function useVisitedUrls(): VisitedUrls {
  // newest first, so the cap drops the oldest
  const urls = ref<ReadonlyArray<string>>(readStringList(STORAGE_KEY).slice(0, LIMIT))

  /**
   * Records that a url was opened, storing its base at the front of the list.
   * @param {string} url - Absolute url that was opened
   * @returns {void}
   */
  function remember(url: string): void {
    const base = baseOf(url)
    if (!base) {
      return
    }

    urls.value = pushRecent(urls.value, base, LIMIT)
    writeJson(STORAGE_KEY, urls.value)
  }

  return { remember }
}
