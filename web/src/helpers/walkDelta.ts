/**
 * Reads a key as a step through a station list. Tab moves the same way the arrows do, so there
 * is one order rather than two, and is left alone in the search field where it is how the caret
 * gets out of a text box in the first place.
 * @param {KeyboardEvent} event - Key press being handled
 * @param {boolean} inSearch - Whether the caret is in the search field
 * @returns {number} - 1 forwards, -1 back, 0 when the key is not a step
 */
export function walkDelta(event: KeyboardEvent, inSearch: boolean): number {
  if (event.key === 'ArrowDown') {
    return 1
  }

  if (event.key === 'ArrowUp') {
    return -1
  }

  if (event.key === 'Tab' && !inSearch) {
    return event.shiftKey ? -1 : 1
  }

  return 0
}
