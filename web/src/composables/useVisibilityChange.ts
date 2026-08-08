import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Runs a callback whenever the tab is hidden or shown, and takes the listener down with the
 * component. What to do on each is the caller's business: one pauses a poll, another re-probes
 * once, and only the wiring is shared.
 * @param {(hidden: boolean) => void} onChange - Called with whether the tab is now hidden
 * @returns {void}
 */
export function useVisibilityChange(onChange: (hidden: boolean) => void): void {
  const handle = (): void => {
    onChange(document.hidden)
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', handle)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handle)
  })
}
