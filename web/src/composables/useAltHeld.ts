import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef } from 'vue'

/**
 * Tracks whether Alt is currently held, which is what reveals the digit badges. The
 * shortcuts themselves are always live, so nothing is unreachable while the badges are
 * hidden. Window blur clears the flag, because releasing Alt outside the page never
 * reaches the keyup listener and would otherwise strand the badges on screen.
 * @returns {ComputedRef<boolean>} - Whether Alt is held
 */
export function useAltHeld(): ComputedRef<boolean> {
  const held = ref(false)

  /**
   * Mirrors the Alt state of a keyboard event.
   * @param {KeyboardEvent} event - Key event from the window listener
   * @returns {void}
   */
  function onKey(event: KeyboardEvent): void {
    // the same chord the shortcuts answer to, so the badges never offer one that is not live
    held.value = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
  }

  /**
   * Clears the flag when the page stops receiving key events.
   * @returns {void}
   */
  function onBlur(): void {
    held.value = false
  }

  onMounted(() => {
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('keyup', onKey)
    window.removeEventListener('blur', onBlur)
  })

  return computed(() => held.value)
}
