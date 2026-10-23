import { onBeforeUnmount, onMounted } from 'vue'
import { historyState } from '@/composables/historyState'

/** Event the extension dispatches on the page once it delivered the visits it buffered */
export const HISTORY_DELIVERED_EVENT = 'diele:history-delivered'

// The api answers a delivery before it writes the visits, so a read sent the moment the event
// arrives can miss them; this long after the last event of a burst they have landed.
const SETTLE_MS = 300
// However long a burst runs, it is answered by one read no later than this after it began.
const MAX_WAIT_MS = 1000

/**
 * Reads a list again once the extension says it delivered visits, for as long as the caller says
 * it is on screen and this account keeps what the extension sends.
 *
 * The event is a hint and nothing more: it carries nothing, and any script on the page could
 * dispatch it, so all it can ever cause is one more read of what the api already serves. A burst
 * of them is answered by a single read.
 * @param {() => boolean} listening - Whether the list the read refreshes is on screen
 * @param {() => Promise<void>} reread - Reads the list again, in a request of its own
 * @returns {void}
 */
export function useHistoryDelivery(listening: () => boolean, reread: () => Promise<void>): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let burstStarted = 0

  /**
   * Returns whether a delivery can have changed anything this caller shows.
   * @returns {boolean} - True while the list is on screen and this account keeps extension visits
   */
  function wanted(): boolean {
    const { available, enabled, sources } = historyState.value

    return listening() && available && enabled && sources.extension
  }

  /**
   * Reads the list once the burst has settled, if it is still wanted by then.
   * @returns {void}
   */
  function settle(): void {
    timer = undefined

    if (wanted()) {
      void reread()
    }
  }

  /**
   * Pushes the read back with every event of a burst, up to the longest a burst may wait.
   * @returns {void}
   */
  function onDelivered(): void {
    if (!wanted()) {
      return
    }

    const now = Date.now()

    if (timer === undefined) {
      burstStarted = now
    } else {
      clearTimeout(timer)
    }

    const delay = Math.min(SETTLE_MS, Math.max(burstStarted + MAX_WAIT_MS - now, 0))
    timer = setTimeout(settle, delay)
  }

  onMounted(() => {
    window.addEventListener(HISTORY_DELIVERED_EVENT, onDelivered)
  })

  onBeforeUnmount(() => {
    window.removeEventListener(HISTORY_DELIVERED_EVENT, onDelivered)
    clearTimeout(timer)
    timer = undefined
  })
}
