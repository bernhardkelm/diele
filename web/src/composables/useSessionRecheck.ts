import { onBeforeUnmount, onMounted } from 'vue'
import { recheckSession } from '@/composables/useSession'
import { useVisibilityChange } from '@/composables/useVisibilityChange'

/**
 * Re-reads who is signed in whenever the tab comes back into view or the window regains focus,
 * for the life of the calling component. Called once, by App: a new tab page spends most of its
 * life behind another one, and a session that ended back there should be noticed when someone
 * looks, not an hour later when a poll happens to answer.
 *
 * Both events, because each misses a case the other catches: switching tabs fires visibility,
 * and coming back from another window that covered this one fires only focus. They usually fire
 * together, and `recheckSession` turns the pair into a single request.
 * @returns {void}
 */
export function useSessionRecheck(): void {
  /**
   * Re-reads the session when the window regains focus.
   * @returns {void}
   */
  const onFocus = (): void => {
    void recheckSession()
  }

  useVisibilityChange((hidden) => {
    if (!hidden) {
      void recheckSession()
    }
  })

  onMounted(() => {
    window.addEventListener('focus', onFocus)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('focus', onFocus)
  })
}
