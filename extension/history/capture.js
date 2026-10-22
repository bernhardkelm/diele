// Turns top-level loads into visits. A load counts once it completed and no error was reported for
// it within a short settling time, so an aborted or failed navigation never becomes a suggestion.
// The raw url waits here in memory for that time and nowhere else.

// Long enough for an error on the same navigation to arrive, and for a page to set its title
const CAPTURE_SETTLE_MS = 1500

// Loads waiting out the settling time, by tab
const pendingNavigations = new Map()

// The last failed navigation per tab, for an error reported before the completion it belongs to
const failedNavigations = new Map()

/**
 * Returns whether an event is about a tab's own top-level document, rather than a frame inside it
 * or a page being prerendered that nobody has looked at yet.
 * @param {{frameId: number, documentLifecycle?: string}} details - The event's details
 * @returns {boolean} - True for the page the tab shows
 */
function isTopLevelLoad(details) {
  return details.frameId === 0 && details.documentLifecycle !== 'prerender'
}

/**
 * Records a load that settled. The tab is looked up only when it could be incognito or its title
 * is wanted: Chrome delivers an incognito tab's events only to an extension allowed there, and
 * without the titles switch no title is read at all. An incognito tab is skipped, and so is a tab
 * that is gone, since whether it was incognito can then no longer be told.
 * @param {number} tabId - Tab the page loaded in
 * @param {string} url - Url as loaded
 * @param {number} at - When it completed, in ms since the epoch
 * @returns {Promise<void>}
 */
async function captureNavigation(tabId, url, at) {
  const stored = await chrome.storage.local.get(HISTORY_TARGET_KEY)
  const target = stored[HISTORY_TARGET_KEY]
  const titles = Boolean(target && target.titles === true)
  const incognito = await chrome.extension.isAllowedIncognitoAccess()

  if (!titles && !incognito) {
    await recordHistoryVisit(url, undefined, at)
    return
  }

  let tab

  try {
    tab = await chrome.tabs.get(tabId)
  } catch {
    return
  }

  if (!tab || tab.incognito) {
    return
  }

  // A tab that moved on during the settling time shows the next page's title, not this one's
  const title = titles && tab.url === url ? tab.title : undefined
  await recordHistoryVisit(url, title, at)
}

/**
 * Holds a completed load for the settling time, unless an error for it already arrived.
 * @param {{tabId: number, frameId: number, url: string, timeStamp: number, documentLifecycle?: string}} details -
 *   The event's details
 * @returns {void}
 */
function onNavigationCompleted(details) {
  if (!isTopLevelLoad(details)) {
    return
  }

  const failed = failedNavigations.get(details.tabId)
  failedNavigations.delete(details.tabId)

  if (failed && failed.url === details.url && details.timeStamp - failed.at < CAPTURE_SETTLE_MS) {
    return
  }

  clearTimeout(pendingNavigations.get(details.tabId)?.timer)

  const timer = setTimeout(() => {
    pendingNavigations.delete(details.tabId)
    void captureNavigation(details.tabId, details.url, details.timeStamp)
  }, CAPTURE_SETTLE_MS)

  pendingNavigations.set(details.tabId, { url: details.url, timer })
}

/**
 * Drops a load still settling when an error arrives for it, and remembers the error for a
 * completion that is still on its way.
 * @param {{tabId: number, frameId: number, url: string, timeStamp: number, documentLifecycle?: string}} details -
 *   The event's details
 * @returns {void}
 */
function onNavigationError(details) {
  if (!isTopLevelLoad(details)) {
    return
  }

  const pending = pendingNavigations.get(details.tabId)
  if (pending && pending.url === details.url) {
    clearTimeout(pending.timer)
    pendingNavigations.delete(details.tabId)
  }

  failedNavigations.set(details.tabId, { url: details.url, at: details.timeStamp })
}

/**
 * Forgets every load still settling, so nothing waiting is recorded after history is switched off.
 * @returns {void}
 */
function forgetPendingNavigations() {
  for (const pending of pendingNavigations.values()) {
    clearTimeout(pending.timer)
  }

  pendingNavigations.clear()
  failedNavigations.clear()
}

/**
 * Listens for loads, once the permission for it is held. Called synchronously at the top of the
 * worker, because an event that woke it is only delivered to listeners added in that first turn,
 * and again whenever the permission is granted while it runs.
 * @returns {void}
 */
function listenForNavigations() {
  if (!chrome.webNavigation) {
    return
  }

  const filter = { url: [{ schemes: ['http', 'https'] }] }

  if (!chrome.webNavigation.onCompleted.hasListener(onNavigationCompleted)) {
    chrome.webNavigation.onCompleted.addListener(onNavigationCompleted, filter)
  }

  if (!chrome.webNavigation.onErrorOccurred.hasListener(onNavigationError)) {
    chrome.webNavigation.onErrorOccurred.addListener(onNavigationError, filter)
  }
}
