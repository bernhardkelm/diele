// Nothing in the page can receive a keystroke until Vue has mounted: the field is not in the
// document yet, so a key pressed while the bundle is still parsing would be lost. An inline
// script in index.html collects those keys, and this is the other end of it.

/**
 * Takes whatever was typed before the app mounted, and ends the capture.
 *
 * Ending it is part of taking it rather than a second call the caller may forget: once a field
 * exists, keys reach it on their own, and a capture still running would collect every one of
 * them a second time.
 * @returns {string} - Characters typed before mount, empty when there were none
 */
export function takeEarlyKeys(): string {
  const capture = window.__dieleEarlyKeys
  delete window.__dieleEarlyKeys

  return capture?.end() ?? ''
}

/**
 * Ends the capture and drops what it collected.
 *
 * Called once the app has mounted, whatever it rendered. Without it a run that ended on the
 * login gate would keep capturing, since that view has no search field to take the buffer, and
 * the password typed into the gate would then be replayed into the launcher the moment the
 * portal mounted behind it.
 * @returns {void}
 */
export function dropEarlyKeys(): void {
  void takeEarlyKeys()
}
