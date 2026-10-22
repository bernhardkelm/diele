// Runs as a content script on the target instance's own pages, and only there. In manifest v3 a
// content script's fetch is made on behalf of the page it runs in, in Chrome and in Firefox from
// 101, so a request from here carries the page's session cookie and its Origin, which is what the
// server's same-origin check asks for; the extension needs no access to the cookie and the server
// needs no exception for it.
//
// Everything stays in the isolated world: the buffer comes from the worker by message and goes
// to the server by fetch, and nothing is written to the DOM or posted to the page, which a
// script of the page's own could read. The page only hears a dataless event once visits arrived.

// The buffer holds at most this many batches, and the server takes two at a time per account
const RELAY_MAX_ROUNDS = 3

// What diele's page listens for to read its history again after this load delivered visits
const HISTORY_DELIVERED_EVENT = 'diele:history-delivered'

// A tab returned to or nudged by the worker runs at most this often; a page load always runs
const RELAY_MIN_INTERVAL_MS = 10_000

// How often a post still in flight renews its lease, well inside the 120 s the lease lasts even
// when a background tab's throttled timers stretch it to once a minute
const RELAY_RENEW_MS = 10_000

/**
 * Fetches one of the instance's endpoints as the page would.
 * @param {{fetch: Function, origin: string}} deps - The fetch to use and the instance's origin
 * @param {string} path - Absolute path on the instance
 * @param {RequestInit} [init] - Method, headers and body, when it is not a plain read
 * @returns {Promise<Response | undefined>} - The response, or undefined when the network failed
 */
async function relayFetch(deps, path, init = {}) {
  try {
    return await deps.fetch(`${deps.origin}${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { accept: 'application/json', ...init.headers },
    })
  } catch {
    return undefined
  }
}

/**
 * Reads a response body as JSON.
 * @param {Response} response - A successful response
 * @returns {Promise<unknown>} - The body, or undefined when it is not JSON
 */
async function relayJson(response) {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * Reads the url templates of the instance's engines and slash commands, which the worker needs to
 * tell a results page apart before it strips the query that shows it.
 * @param {{fetch: Function, origin: string}} deps - The fetch to use and the instance's origin
 * @returns {Promise<string[] | undefined>} - The templates, or undefined when they could not be read
 */
async function readRelayTemplates(deps) {
  const response = await relayFetch(deps, '/api/config')
  const config = response && response.ok ? await relayJson(response) : undefined

  if (!config || typeof config !== 'object') {
    return undefined
  }

  return [...(config.engines ?? []), ...(config.commands ?? [])]
    .map((entry) => entry && entry.urlTemplate)
    .filter((template) => typeof template === 'string')
}

/**
 * Asks whether the origin answers `/status` the way diele does. A page in scope that belongs to
 * some other app on the same origin is asked nothing further and sent nothing, and neither is a
 * dev server that serves its index page there instead of proxying the api. This is no proof,
 * since anything on the origin can answer the same, which is why diele must own its origin.
 * @param {{fetch: Function, origin: string}} deps - The fetch to use and the instance's origin
 * @returns {Promise<'diele' | 'other' | 'offline'>} - Diele when the answer has diele's shape,
 *   other when something else answered, offline when nothing did
 */
async function readRelayOrigin(deps) {
  const response = await relayFetch(deps, '/status')
  if (!response) {
    return 'offline'
  }

  const body = response.ok ? await relayJson(response) : undefined
  const diele = Boolean(body) && body.status === 'ok' && typeof body.version === 'string'

  return diele ? 'diele' : 'other'
}

/**
 * Asks diele what it accepts from the account signed in. The state names that account by
 * an opaque value, and a 401 instead of a state means nobody is signed in.
 * @param {{fetch: Function, origin: string}} deps - The fetch to use and the instance's origin
 * @returns {Promise<{signedIn: boolean, state?: object, engineTemplates?: string[]} | undefined>} -
 *   What to report, or undefined when the instance did not answer in a way worth reporting
 */
async function readRelayReport(deps) {
  const response = await relayFetch(deps, '/api/history/state')
  if (response && response.status === 401) {
    return { signedIn: false }
  }

  const state = response && response.ok ? await relayJson(response) : undefined
  if (!state || typeof state !== 'object') {
    return undefined
  }

  const accepts =
    state.available === true && state.sources?.extension === true && state.enabled === true
  const engineTemplates = accepts ? await readRelayTemplates(deps) : undefined

  return { signedIn: true, state, engineTemplates }
}

/**
 * Hands a message to the worker.
 * @param {{send: Function}} deps - The channel to the worker
 * @param {object} message - What to tell it
 * @returns {Promise<unknown>} - Its reply, or undefined when it could not be reached
 */
async function relaySend(deps, message) {
  try {
    return await deps.send(message)
  } catch {
    return undefined
  }
}

/**
 * Sends one batch and says what became of it: delivered, refused by a switch, malformed beyond
 * repair, or worth sending again later.
 * @param {{fetch: Function, origin: string}} deps - The fetch to use and the instance's origin
 * @param {Array<{url: string, title?: string, at: string}>} visits - One batch
 * @returns {Promise<'accepted' | 'refused' | 'unusable' | 'kept'>} - The outcome
 */
async function postRelayBatch(deps, visits) {
  const response = await relayFetch(deps, '/api/history/visits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'extension', visits }),
  })

  if (!response) {
    return 'kept'
  }

  if (response.ok) {
    return 'accepted'
  }

  if (response.status === 403) {
    return 'refused'
  }

  // A batch the server cannot read now it will never read, and sending it on every load would
  // keep the rest behind it
  if (response.status === 400 || response.status === 413) {
    return 'unusable'
  }

  return 'kept'
}

/**
 * Reports the instance's state to the worker and sends what it hands back, a batch at a time,
 * each under a lease that keeps another diele tab from being handed the same visits meanwhile.
 * A 403 means a switch went off since the state was read, so the buffer is discarded; a 400 or
 * a 413 is a batch the server will never read, settled like a delivered one; a 401, a 429 or a
 * network failure give the lease back and leave the batch for the next load. An origin whose
 * `/status` is not diele's is reported as such and sent nothing, the buffer left waiting.
 * @param {{fetch: Function, origin: string, send: Function}} deps - The fetch to use, the
 *   instance's origin and the channel to the worker
 * @param {{onlyIfDue?: boolean}} [options] - Whether to stop unless the worker says something is
 *   due: visits waiting, or an instance it has not heard from yet
 * @returns {Promise<'outside' | 'unrecognised' | 'offline' | 'idle' | 'delivered' | 'refused' | 'kept'>} -
 *   How the run ended
 */
async function runHistoryRelay(deps, options = {}) {
  // Firefox's match patterns cannot name a port, so the relay can land on another port of the
  // host; the worker, which compares the whole origin, says whether this page is the target's
  // before anything is requested from it
  const ready = await relaySend(deps, { kind: 'history:ready' })
  if (!ready || ready.inScope !== true) {
    return 'outside'
  }

  if (options.onlyIfDue === true && ready.due !== true) {
    return 'idle'
  }

  const origin = await readRelayOrigin(deps)
  if (origin === 'other') {
    await relaySend(deps, { kind: 'history:unrecognised' })
    return 'unrecognised'
  }

  const report = origin === 'diele' ? await readRelayReport(deps) : undefined
  if (!report) {
    return 'offline'
  }

  const reply = await relaySend(deps, { kind: 'history:report', ...report })
  const { outcome, accepted } = await deliverRelayBatches(deps, reply)

  // The page already read its history before this load delivered anything, so it is told to
  // read it again; the signal says that something arrived and nothing about what
  if (accepted) {
    relayAnnounce(deps)
  }

  return outcome
}

/**
 * Posts what the worker hands out, a batch at a time under its lease, and settles each one.
 * @param {{fetch: Function, origin: string, send: Function}} deps - The fetch to use, the
 *   instance's origin and the channel to the worker
 * @param {unknown} reply - The worker's answer to the report, holding the first batch
 * @returns {Promise<{outcome: 'idle' | 'delivered' | 'refused' | 'kept', accepted: boolean}>} -
 *   How the posting ended, and whether the server took at least one batch
 */
async function deliverRelayBatches(deps, reply) {
  let next = reply
  let outcome = 'idle'
  let accepted = false

  for (let round = 0; round < RELAY_MAX_ROUNDS; round += 1) {
    const visits = next && Array.isArray(next.visits) ? next.visits : []
    if (visits.length === 0) {
      return { outcome, accepted }
    }

    const lease = next.lease
    const result = await whileRenewing(deps, lease, () => postRelayBatch(deps, visits))

    if (result === 'refused') {
      await relaySend(deps, { kind: 'history:refused', lease })
      return { outcome: 'refused', accepted }
    }

    if (result === 'kept') {
      await relaySend(deps, { kind: 'history:release', lease })
      return { outcome: 'kept', accepted }
    }

    outcome = 'delivered'
    accepted = accepted || result === 'accepted'
    const sent = visits.map((visit) => ({ url: visit.url, at: visit.at }))
    const more = round + 1 < RELAY_MAX_ROUNDS
    next = await relaySend(deps, { kind: 'history:settled', visits: sent, lease, more })
  }

  return { outcome, accepted }
}

/**
 * Runs a post while renewing the lease it goes under, so a slow server does not let the lease run
 * out and a second relay send the same batch.
 * @param {{send: Function, setInterval?: Function, clearInterval?: Function}} deps - The channel
 *   to the worker and the timers to renew by
 * @param {unknown} lease - The lease the post goes under
 * @param {() => Promise<string>} post - The post
 * @returns {Promise<string>} - What the post resolved to
 */
async function whileRenewing(deps, lease, post) {
  const renew = () => void relaySend(deps, { kind: 'history:renew', lease })
  const timer = deps.setInterval ? deps.setInterval(renew, RELAY_RENEW_MS) : undefined

  try {
    return await post()
  } finally {
    if (timer !== undefined) {
      deps.clearInterval(timer)
    }
  }
}

/**
 * Tells the page that visits were delivered, so it reads its history again. A failure here
 * changes nothing about what was delivered.
 * @param {{announce?: Function}} deps - What signals the page
 * @returns {void}
 */
function relayAnnounce(deps) {
  try {
    deps.announce?.()
  } catch {
    // the visits are delivered either way; only the page's list stays as it was
  }
}

/**
 * Wraps the relay so it runs once at a time in this tab, and, unless a page load asks, no more
 * often than every RELAY_MIN_INTERVAL_MS. A run that is not due is left to the worker to judge,
 * so a tab returned to with nothing waiting asks nothing of the instance.
 * @param {{fetch: Function, origin: string, send: Function}} deps - What runHistoryRelay needs
 * @param {() => number} [now] - Current time, in ms
 * @returns {(trigger: 'load' | 'visible' | 'flush') => Promise<string>} - Runs the relay for a
 *   trigger, answering how the run ended, or busy or throttled when it did not start
 */
function relayTriggerOf(deps, now = () => Date.now()) {
  let running = false
  let last = -Infinity

  return async (trigger) => {
    if (running) {
      return 'busy'
    }

    if (trigger !== 'load' && now() - last < RELAY_MIN_INTERVAL_MS) {
      return 'throttled'
    }

    running = true
    last = now()

    try {
      return await runHistoryRelay(deps, { onlyIfDue: trigger !== 'load' })
    } finally {
      running = false
    }
  }
}

/**
 * Returns whether a message is the worker asking this tab to send: the flush kind, from this
 * extension, and from no tab, since a content script anywhere carries one.
 * @param {unknown} message - What arrived
 * @param {chrome.runtime.MessageSender} sender - Who sent it
 * @param {string} extensionId - This extension's id
 * @returns {boolean} - True for the worker's nudge
 */
function isWorkerFlush(message, sender, extensionId) {
  const flush = message !== null && typeof message === 'object' && message.kind === 'history:flush'
  return flush && Boolean(sender) && sender.id === extensionId && sender.tab === undefined
}

/**
 * Runs the relay again when this tab is shown after being away, and when the worker nudges it
 * after a visit. Of the page it reads whether it is visible, and nothing else.
 * @param {{document: Document, chrome: object}} world - The content script's global scope
 * @param {(trigger: 'visible' | 'flush') => Promise<string>} trigger - The wrapped relay
 * @returns {void}
 */
function listenForRelayTriggers(world, trigger) {
  world.document.addEventListener('visibilitychange', () => {
    if (world.document.visibilityState === 'visible') {
      void trigger('visible')
    }
  })

  world.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isWorkerFlush(message, sender, world.chrome.runtime.id)) {
      return false
    }

    // Answered at once, so the worker's send resolves; a send that rejects means no relay here
    sendResponse({ ok: true })
    void trigger('flush')
    return false
  })
}

/**
 * Builds the relay's dependencies from the content script's own globals. The plain fetch is the
 * page-context one in manifest v3; Firefox's `content.fetch`, which once filled that role, only
 * exists in manifest v2, and a global of that name here could be an element or a frame the page
 * named, so it is never consulted.
 * @param {{location: Location, fetch: Function, chrome: object}} world - The content script's
 *   global scope
 * @returns {{fetch: Function, origin: string, send: Function, setInterval: Function, clearInterval: Function, announce: Function}} -
 *   What runHistoryRelay needs
 */
function relayDepsOf(world) {
  return {
    origin: world.location.origin,
    fetch: (input, init) => world.fetch(input, init),
    send: (message) => world.chrome.runtime.sendMessage(message),
    setInterval: (callback, ms) => world.setInterval(callback, ms),
    clearInterval: (timer) => world.clearInterval(timer),
    // The one thing the page ever receives: a plain Event, no detail, so a page script firing
    // the same name can only make diele read its own history again
    announce: () => world.dispatchEvent(new world.Event(HISTORY_DELIVERED_EVENT)),
  }
}
