// The history and titles boxes on each row. Their state is read from chrome.storage.local, where
// the worker keeps it; switching only asks, since the worker is what finishes a change the prompt
// may outlive the popup for.

// What a row says beside its history box: a few words, so the line never wraps. The off state is
// a word rather than nothing, so the row reads the same without its glyph.
const HISTORY_STATUS_TEXT = {
  off: 'off',
  needsHttps: 'needs https',
  waiting: 'open a diele tab once',
  unrecognised: 'not diele',
  signedOut: 'signed out',
  refused: 'not accepted here',
  optIn: 'not opted in',
  recording: 'recording',
  noAccess: 'no access',
  failed: 'could not switch on',
}

// What assistive technology hears after those words, where they leave the reason or the remedy
// out; read out only, never shown
const HISTORY_STATUS_MORE = {
  needsHttps: 'plain http would send your session and your pages across the network in the clear',
  waiting: 'the extension has not seen this instance yet, open it in a tab once',
  unrecognised: 'this address does not answer like diele, so nothing is sent',
  signedOut: 'sign in on this instance to start recording',
  refused: 'this instance does not accept visits from the extension',
  optIn: 'opt in under History in this instance settings',
  noAccess: 'the browser did not grant the access history needs',
  failed: 'every permission it asked for was given back, try again',
}

// What a row says beside its titles box
const HISTORY_TITLES_TEXT = {
  on: 'sent',
  off: 'not sent',
  noAccess: 'no access',
  failed: 'could not switch on',
}

let historyView = { target: undefined, cached: undefined, waiting: 0 }

// Why the last try on a box did not switch it on, as a status key, said until the next try
const historyNotices = new Map()

// Boxes whose switch is still being asked for: a repaint while the prompt is open leaves them as
// the click set them, rather than flipping them back to what is stored
const historySwitching = new Set()

/**
 * Names a box, for the notices and the switches in flight.
 * @param {'history' | 'titles'} kind - Which box of the row
 * @param {string} id - The row's instance
 * @returns {string} - The key
 */
function historyBoxKey(kind, id) {
  return `${kind}:${id}`
}

/**
 * Marks a box as being switched, and forgets what its last try said.
 * @param {'history' | 'titles'} kind - Which box of the row
 * @param {string} id - The row's instance
 * @returns {void}
 */
function beginHistorySwitch(kind, id) {
  historySwitching.add(historyBoxKey(kind, id))
  historyNotices.delete(historyBoxKey(kind, id))
}

/**
 * Marks a box as switched, keeping why it did not go on when it did not.
 * @param {'history' | 'titles'} kind - Which box of the row
 * @param {string} id - The row's instance
 * @param {string | undefined} notice - Status key saying why it failed, undefined when it did not
 * @returns {void}
 */
function endHistorySwitch(kind, id, notice) {
  historySwitching.delete(historyBoxKey(kind, id))

  if (notice) {
    historyNotices.set(historyBoxKey(kind, id), notice)
  }
}

/**
 * Sets a box to what is stored, unless its switch is still being asked for.
 * @param {HTMLInputElement} box - The checkbox
 * @param {string} key - The box's key
 * @param {boolean} on - Whether what is stored says on
 * @returns {void}
 */
function paintHistoryBox(box, key, on) {
  if (!historySwitching.has(key)) {
    box.checked = on
  }
}

/**
 * Reads what the worker stored: the target, what it last reported and how much waits to be sent.
 * Only the count of the buffer is read into the popup, never its pages.
 * @returns {Promise<void>}
 */
async function readHistoryView() {
  const stored = await chrome.storage.local.get([
    HISTORY_TARGET_KEY,
    HISTORY_STATE_KEY,
    HISTORY_BUFFER_KEY,
  ])
  const buffer = stored[HISTORY_BUFFER_KEY]

  historyView = {
    target: stored[HISTORY_TARGET_KEY],
    cached: stored[HISTORY_STATE_KEY],
    waiting: buffer && Array.isArray(buffer.visits) ? buffer.visits.length : 0,
  }
}

/**
 * Returns what a row's history box says about its instance: why the last try failed while it
 * stays off, and otherwise what the instance last said.
 * @param {{id: string, url: string}} instance - The row's instance
 * @returns {{text: string, more: string}} - The few words shown, and what is only read out
 */
function historyStatusText(instance) {
  if (historyScopeOf(instance.url) === undefined) {
    return { text: HISTORY_STATUS_TEXT.needsHttps, more: HISTORY_STATUS_MORE.needsHttps }
  }

  const status = historyStatusOf(instance.id, historyView.target, historyView.cached)
  const notice = historyNotices.get(historyBoxKey('history', instance.id))
  const key = status === 'off' && notice ? notice : status

  if (key === 'recording' && historyView.waiting > 0) {
    return { text: `recording, ${historyView.waiting} waiting`, more: 'until the next visit to it' }
  }

  return { text: HISTORY_STATUS_TEXT[key], more: HISTORY_STATUS_MORE[key] ?? '' }
}

/**
 * Paints a row's history box: whether it is on, whether it can be, and what the instance last
 * said.
 * @param {HTMLLIElement} row - The row
 * @param {{id: string, url: string}} instance - The row's instance
 * @param {string} label - What the row calls it, for the switch's name
 * @returns {void}
 */
function paintHistoryControls(row, instance, label) {
  const toggle = row.querySelector('.row__toggle')
  const status = row.querySelector('.row__status')
  const more = row.querySelector('.row__status-more')
  const on = historyStatusOf(instance.id, historyView.target, historyView.cached) !== 'off'
  const { text, more: detail } = historyStatusText(instance)

  status.id = `history-${instance.id}`
  more.id = `history-more-${instance.id}`
  toggle.dataset.id = instance.id
  toggle.disabled = historyScopeOf(instance.url) === undefined
  paintHistoryBox(toggle, historyBoxKey('history', instance.id), on)
  toggle.setAttribute('aria-describedby', `${status.id} ${more.id}`)
  toggle.setAttribute('aria-label', `History for ${label}`)
  status.textContent = text
  more.textContent = detail

  paintTitlesControls(row, instance, label, on)
}

/**
 * Returns whether page titles are switched on for the target.
 * @returns {boolean} - True when titles go with the visits
 */
function historyTitlesOn() {
  const target = historyView.target
  return Boolean(target && typeof target === 'object' && target.titles === true)
}

/**
 * Paints a row's titles box, which only shows while history is on for that row.
 * @param {HTMLLIElement} row - The row
 * @param {{id: string}} instance - The row's instance
 * @param {string} label - What the row calls it, for the switch's name
 * @param {boolean} recording - Whether history is on for the row
 * @returns {void}
 */
function paintTitlesControls(row, instance, label, recording) {
  const line = row.querySelector('.row__history--titles')
  const toggle = row.querySelector('.row__titles')
  const status = row.querySelector('.row__titles-status')
  const on = recording && historyTitlesOn()
  const key = historyBoxKey('titles', instance.id)
  const notice = on ? undefined : historyNotices.get(key)

  line.hidden = !recording
  status.id = `titles-${instance.id}`
  status.textContent = HISTORY_TITLES_TEXT[notice ?? (on ? 'on' : 'off')]
  toggle.dataset.id = instance.id
  paintHistoryBox(toggle, key, on)
  toggle.setAttribute('aria-describedby', status.id)
  toggle.setAttribute('aria-label', `Page titles for ${label}`)
}

/**
 * Asks for the permissions recording needs, then has the worker make the instance the target.
 * Must be called synchronously from the box's change: the browser only shows the prompt inside a
 * user gesture, so the request goes out before anything is awaited.
 * @param {{id: string, url: string}} instance - Instance to send visits to
 * @returns {Promise<'on' | 'denied' | 'refused' | 'failed'>} - On when the instance is the target
 *   afterwards, denied when the prompt was declined, refused when the worker found the instance
 *   gone or its access missing and gave back what was granted for it, failed when the browser
 *   would not finish the switch and history is off
 */
function switchHistoryOn(instance) {
  const scope = historyScopeOf(instance.url)
  if (!scope) {
    return Promise.resolve('denied')
  }

  // Not awaited, which would spend the gesture; the worker reads it if the prompt closes the popup
  void chrome.storage.local.set({
    [HISTORY_PENDING_KEY]: { id: instance.id, at: Date.now(), kind: 'history' },
  })

  const request = chrome.permissions.request({
    permissions: HISTORY_API_PERMISSIONS,
    origins: [scope.permission],
  })

  return request.then(async (granted) => {
    if (!granted) {
      await chrome.storage.local.remove(HISTORY_PENDING_KEY)
      return 'denied'
    }

    const reply = await chrome.runtime.sendMessage({ kind: 'history:activate', id: instance.id })
    if (reply && reply.active === true) {
      return 'on'
    }

    return reply && reply.outcome === 'refused' ? 'refused' : 'failed'
  })
}

/**
 * Has the worker switch history off and give every permission back.
 * @returns {Promise<void>}
 */
async function switchHistoryOff() {
  await chrome.runtime.sendMessage({ kind: 'history:deactivate' })
}

/**
 * Asks for `tabs`, the one permission titles need, then has the worker switch titles on. Must be
 * called synchronously from the box's change, for the same reason as switchHistoryOn.
 * @param {{id: string}} instance - The target instance
 * @returns {Promise<'on' | 'denied' | 'failed'>} - On when titles are on afterwards, denied when
 *   the prompt was declined, failed when the worker refused and gave `tabs` back
 */
function switchTitlesOn(instance) {
  void chrome.storage.local.set({
    [HISTORY_PENDING_KEY]: { id: instance.id, at: Date.now(), kind: 'titles' },
  })

  const request = chrome.permissions.request({ permissions: HISTORY_TITLE_PERMISSIONS })

  return request.then(async (granted) => {
    if (!granted) {
      await chrome.storage.local.remove(HISTORY_PENDING_KEY)
      return 'denied'
    }

    const reply = await chrome.runtime.sendMessage({ kind: 'history:titles', id: instance.id })
    return reply && reply.titles === true ? 'on' : 'failed'
  })
}

/**
 * Has the worker switch titles off, strip those waiting and give `tabs` back.
 * @returns {Promise<void>}
 */
async function switchTitlesOff() {
  await chrome.runtime.sendMessage({ kind: 'history:untitled' })
}
