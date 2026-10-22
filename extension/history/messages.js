// What the worker answers. The relay may only report, settle and release, and only from the
// target's own top-level pages outside incognito; switching on and off is the extension's own
// pages' to ask.

// What a relay may say, and what only the popup and the options page may
const RELAY_MESSAGES = [
  'history:ready',
  'history:report',
  'history:settled',
  'history:release',
  'history:renew',
  'history:unrecognised',
  'history:refused',
]
const POPUP_MESSAGES = [
  'history:activate',
  'history:deactivate',
  'history:titles',
  'history:untitled',
]

/**
 * Returns whether a message comes from one of this extension's own pages, the popup or the
 * options page, rather than a content script.
 * @param {chrome.runtime.MessageSender} sender - Who sent it
 * @returns {boolean} - True for an extension page
 */
function isExtensionPage(sender) {
  return sender.id === chrome.runtime.id && String(sender.url).startsWith(chrome.runtime.getURL(''))
}

/**
 * Returns the target scope a relay message came from, when it may speak for it at all.
 * @param {chrome.runtime.MessageSender} sender - Who sent it
 * @returns {Promise<{url: string} | undefined>} - The scope, or undefined when the sender is not
 *   the relay on the target's own page
 */
async function relayScopeOf(sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.tab.incognito) {
    return undefined
  }

  if (sender.frameId !== 0) {
    return undefined
  }

  const { target } = await readHistoryStorage()
  const scope = target && typeof target.url === 'string' ? historyScopeOf(target.url) : undefined

  return scope && scope.url === target.url && isInHistoryScope(sender.url, scope)
    ? scope
    : undefined
}

/**
 * Answers a relay that is on the target's page, and remembers its tab for the nudge after a visit.
 * Something is due when visits wait, or when the instance has not been heard from yet; a relay
 * run by a tab returned to or a nudge stops at that answer otherwise.
 * @param {{url: string}} scope - The target scope the relay runs in
 * @param {number} tabId - The relay's tab
 * @returns {Promise<{inScope: true, due: boolean}>} - The reply
 */
async function readyRelay(scope, tabId) {
  await rememberRelayTab(tabId)

  const { cached, buffer } = await readHistoryStorage()
  const heard = cached !== null && typeof cached === 'object' && cached.instance === scope.url
  const waiting = buffer && Array.isArray(buffer.visits) && buffer.visits.length > 0

  return { inScope: true, due: !heard || Boolean(waiting) }
}

/**
 * Handles a message from the relay.
 * @param {{kind: string, visits?: unknown, lease?: unknown, more?: unknown}} message - What it said
 * @param {chrome.runtime.MessageSender} sender - Who said it
 * @returns {Promise<unknown>} - The reply
 */
async function answerRelay(message, sender) {
  const scope = await relayScopeOf(sender)

  if (message.kind === 'history:ready') {
    return scope ? readyRelay(scope, sender.tab.id) : { inScope: false }
  }

  if (!scope) {
    return { visits: [] }
  }

  if (message.kind === 'history:report') {
    return takeHistoryReport(message, scope.url)
  }

  if (message.kind === 'history:settled') {
    const sent = Array.isArray(message.visits) ? message.visits : []
    return settleHistoryBatch(sent, message.lease, message.more === true, scope.url)
  }

  if (message.kind === 'history:release') {
    await releaseHistoryBatch(message.lease)
    return { visits: [] }
  }

  if (message.kind === 'history:renew') {
    await renewHistoryBatch(message.lease)
    return { visits: [] }
  }

  if (message.kind === 'history:unrecognised') {
    await markHistoryUnrecognised(scope.url)
    return { visits: [] }
  }

  await refuseHistory(scope.url, message.lease)
  return { visits: [] }
}

/**
 * Handles a message from the popup.
 * @param {{kind: string, id?: unknown}} message - What it asked
 * @returns {Promise<unknown>} - The reply
 */
async function answerPopup(message) {
  if (message.kind === 'history:activate' && typeof message.id === 'string') {
    const outcome = await activateHistory(message.id)
    return { active: outcome === 'active', outcome }
  }

  if (message.kind === 'history:titles' && typeof message.id === 'string') {
    return { titles: await enableHistoryTitles(message.id) }
  }

  if (message.kind === 'history:untitled') {
    await disableHistoryTitles()
    return { titles: false }
  }

  if (message.kind === 'history:deactivate') {
    await deactivateHistory()
    return { active: false }
  }

  return undefined
}

/**
 * Routes a runtime message to its handler and answers asynchronously, which the browser only
 * allows a listener that returns true and calls sendResponse.
 * @param {unknown} message - What was sent
 * @param {chrome.runtime.MessageSender} sender - Who sent it
 * @param {(reply: unknown) => void} sendResponse - Answers the sender
 * @returns {boolean} - True when an answer will follow
 */
function onHistoryMessage(message, sender, sendResponse) {
  const kind = message !== null && typeof message === 'object' ? message.kind : undefined
  let answer

  if (RELAY_MESSAGES.includes(kind)) {
    answer = isExtensionPage(sender) ? undefined : answerRelay(message, sender)
  } else if (POPUP_MESSAGES.includes(kind)) {
    answer = isExtensionPage(sender) ? answerPopup(message) : undefined
  }

  if (!answer) {
    return false
  }

  answer.then(sendResponse, () => sendResponse(undefined))
  return true
}
