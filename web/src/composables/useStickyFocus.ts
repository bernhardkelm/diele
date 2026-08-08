import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Puts the caret back on the row a press dropped it from.
 *
 * Pressing something that cannot hold focus, the page background or a line of prose, hands the
 * caret to the document body and leaves the list pointing at a row nothing is focused on. The
 * press itself is left to happen rather than cancelled, so a drag still selects text to copy;
 * the caret is put back on release, once that selection has been made. Restoring it any earlier
 * lands mid-drag and collapses the selection being made.
 * @param {string} selector - Marks the elements worth keeping the caret on
 * @returns {void}
 */
export function useStickyFocus(selector: string): void {
  let pressing = false
  let pending: HTMLElement | null = null

  /**
   * Marks that a press is under way, which is what tells a lost caret from a handed-over one.
   * @returns {void}
   */
  function onPointerdown(): void {
    pressing = true
  }

  /**
   * Remembers the row a press is about to take the caret off.
   * @param {FocusEvent} event - Focus leaving an element
   * @returns {void}
   */
  function onFocusout(event: FocusEvent): void {
    // Something that can hold the caret taking it is a move to honour rather than undo, and so
    // is one the page made itself. Only a press that left the caret nowhere is put back.
    if (event.relatedTarget || !pressing) {
      return
    }

    pending = (event.target as HTMLElement | null)?.closest<HTMLElement>(selector) ?? null
  }

  /**
   * Restores the caret once the press is over.
   * @returns {void}
   */
  function onPointerup(): void {
    pressing = false

    const row = pending
    pending = null

    // A row the press removed from the list has nothing to go back to, and anything that took
    // the caret in the meantime keeps it.
    if (row?.isConnected && document.activeElement === document.body) {
      row.focus()
    }
  }

  /**
   * Forgets a pending restore when the press ends outside the window, which never reports up.
   * @returns {void}
   */
  function onBlur(): void {
    pressing = false
    pending = null
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onPointerdown, true)
    document.addEventListener('focusout', onFocusout, true)
    document.addEventListener('pointerup', onPointerup, true)
    window.addEventListener('blur', onBlur)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerdown, true)
    document.removeEventListener('focusout', onFocusout, true)
    document.removeEventListener('pointerup', onPointerup, true)
    window.removeEventListener('blur', onBlur)
  })
}
