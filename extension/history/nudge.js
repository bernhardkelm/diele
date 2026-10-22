// Asks the diele tabs already open to send, shortly after a visit was buffered. Without it, a
// diele tab left open while browsing elsewhere would only send on its next load. Which tabs are
// open is learnt from their relays, never looked up, so this needs no permission of its own.

// Long enough for a burst of loads to end in one nudge, short enough for a worker that the
// browser keeps alive for some 30 s after the event that woke it
const HISTORY_NUDGE_MS = 5000

// More open diele tabs than anyone keeps; past it the oldest are forgotten
const HISTORY_TABS_MAX = 20

let nudgeTimer

/**
 * Reads the remembered tab ids.
 * @returns {Promise<number[]>} - The ids, of the shape storage may have lost
 */
async function readRelayTabs() {
  const stored = await chrome.storage.session.get(HISTORY_TABS_KEY)
  const ids = stored[HISTORY_TABS_KEY]

  return Array.isArray(ids) ? ids.filter((id) => Number.isInteger(id)) : []
}

/**
 * Remembers a tab whose relay reported from the target's page.
 * @param {number} tabId - The tab
 * @returns {Promise<unknown>} - Settles once it is written
 */
function rememberRelayTab(tabId) {
  return serialiseHistory(async () => {
    const ids = await readRelayTabs()
    if (!Number.isInteger(tabId) || ids.includes(tabId)) {
      return
    }

    const next = [...ids, tabId].slice(-HISTORY_TABS_MAX)
    await chrome.storage.session.set({ [HISTORY_TABS_KEY]: next })
  })
}

/**
 * Forgets a tab that closed, or no longer answers.
 * @param {number} tabId - The tab
 * @returns {Promise<unknown>} - Settles once it is written
 */
function forgetRelayTab(tabId) {
  return serialiseHistory(async () => {
    const ids = await readRelayTabs()
    if (ids.includes(tabId)) {
      await chrome.storage.session.set({ [HISTORY_TABS_KEY]: ids.filter((id) => id !== tabId) })
    }
  })
}

/**
 * Forgets every tab, when the target changes or history is switched off.
 * @returns {Promise<void>}
 */
async function forgetRelayTabs() {
  clearTimeout(nudgeTimer)
  nudgeTimer = undefined
  await chrome.storage.session.remove(HISTORY_TABS_KEY)
}

/**
 * Asks every remembered tab to send, and forgets each one that cannot be reached: its relay
 * answers at once, so a send that rejects means the tab closed or left diele.
 * @returns {Promise<void>}
 */
async function nudgeRelayTabs() {
  const ids = await readRelayTabs()

  await Promise.all(
    ids.map(async (tabId) => {
      try {
        await chrome.tabs.sendMessage(tabId, { kind: 'history:flush' })
      } catch {
        await forgetRelayTab(tabId)
      }
    }),
  )
}

/**
 * Nudges the open diele tabs HISTORY_NUDGE_MS after the last of a burst of visits, once for the
 * whole burst.
 * @returns {void}
 */
function scheduleHistoryNudge() {
  clearTimeout(nudgeTimer)
  nudgeTimer = setTimeout(() => {
    nudgeTimer = undefined
    nudgeRelayTabs().catch(() => undefined)
  }, HISTORY_NUDGE_MS)
}
