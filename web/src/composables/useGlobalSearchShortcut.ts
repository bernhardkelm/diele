import { onBeforeUnmount, onMounted } from 'vue'

export interface GlobalSearchShortcutOptions {
  /** Puts the caret in the field and selects what is there, for a deliberate jump to it */
  focusAndSelect: () => void
  /** Puts the caret in the field without selecting, so a typed character lands after the text */
  focus: () => void
}

/** Controls that consume an ordinary keystroke themselves, so the page must not take it. */
const TYPING_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

/**
 * Returns whether the page holds no focus of its own, which is what a click on empty space
 * leaves behind.
 * @returns {boolean} - True when nothing on the page is focused
 */
function nothingFocused(): boolean {
  const active = document.activeElement

  return !active || active === document.body
}

/**
 * Routes keys pressed anywhere on the page to the search field.
 *
 * Page-wide rather than the field's own, which is why it does not belong to whatever renders
 * the field: a slash from anywhere that is not already a text box, and ordinary typing from a
 * page that has lost its focus altogether.
 * @param {GlobalSearchShortcutOptions} options - The two ways of reaching the field
 * @returns {void}
 */
export function useGlobalSearchShortcut(options: GlobalSearchShortcutOptions): void {
  /**
   * Reads a window-level key press and decides whether the field should take it.
   * @param {KeyboardEvent} event - Key event from the window listener
   * @returns {void}
   */
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    if (event.key === '/') {
      // a control that takes typing keeps the key, including a select, where `/` jumps to the
      // option starting with it
      if (event.target instanceof HTMLElement && TYPING_TAGS.has(event.target.tagName)) {
        return
      }

      event.preventDefault()
      options.focusAndSelect()
      return
    }

    // Tab or Enter into a page that holds no focus means "start here", and the field is where
    // the portal starts. Selecting what is already typed is what tabbing into a text box does
    // anyway, and it leaves Enter meaning "search this again" rather than nothing at all.
    if ((event.key === 'Tab' ? !event.shiftKey : event.key === 'Enter') && nothingFocused()) {
      event.preventDefault()
      options.focusAndSelect()
      return
    }

    // Clicking the page background drops focus, and every keystroke after it would otherwise go
    // nowhere. Space is left alone, because with nothing focused it is how a page is scrolled.
    // Not prevented and not selected: the character itself still lands, at the end of whatever
    // was already typed.
    if (event.key.length === 1 && event.key !== ' ' && nothingFocused()) {
      options.focus()
    }
  }

  onMounted(() => window.addEventListener('keydown', onWindowKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))
}
