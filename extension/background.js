// The worker in Chrome, an event page in Firefox, which runs manifest v3 background scripts as a
// page and has no service workers for extensions. Both load the same classic files: Chrome through
// importScripts below, Firefox from the manifest's background.scripts, which lists them in this
// order. Keep the two lists in step; a test compares them.
if (typeof importScripts === 'function') {
  importScripts(
    'storage.js',
    'history/keys.js',
    'history/hosts.js',
    'history/tokens.js',
    'history/searchPages.js',
    'history/filter.js',
    'history/scope.js',
    'history/buffer.js',
    'history/state.js',
    'history/store.js',
    'history/nudge.js',
    'history/capture.js',
    'history/target.js',
    'history/messages.js',
  )
}

// Every listener is added in the worker's first turn, the only time Chrome delivers the event
// that woke it.
listenForNavigations()

chrome.runtime.onMessage.addListener(onHistoryMessage)

chrome.permissions.onAdded.addListener(() => {
  listenForNavigations()
  void resumePendingHistory()
})

chrome.permissions.onRemoved.addListener(() => {
  void checkHistoryTarget()
})

chrome.runtime.onInstalled.addListener(() => {
  void restoreHistoryRelay()
})

// Needs no permission: the event carries the tab's id and nothing it showed
chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetRelayTab(tabId)
})

chrome.runtime.onStartup.addListener(() => {
  void restoreHistoryRelay()
})

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') {
    void checkHistoryTarget()
  }
})
