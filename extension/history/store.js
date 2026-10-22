// Every read-modify-write of history's storage, run one after another. A navigation, a relay
// report and a switch from the popup can all arrive at once, and chrome.storage has no
// transaction to keep the later write from undoing the earlier one.

let historyQueue = Promise.resolve()

/**
 * Runs a task after every task queued before it has settled.
 * @param {() => Promise<unknown>} task - Work on history's storage
 * @returns {Promise<unknown>} - What the task resolved to
 */
function serialiseHistory(task) {
  const run = historyQueue.then(task)
  historyQueue = run.catch(() => undefined)
  return run
}

/**
 * Reads the target, the state it last reported, the buffer and the lease on it.
 * @returns {Promise<{target: unknown, cached: unknown, buffer: unknown, lease: unknown}>} - What
 *   is stored
 */
async function readHistoryStorage() {
  const stored = await chrome.storage.local.get([
    HISTORY_TARGET_KEY,
    HISTORY_STATE_KEY,
    HISTORY_BUFFER_KEY,
    HISTORY_LEASE_KEY,
  ])

  return {
    target: stored[HISTORY_TARGET_KEY],
    cached: stored[HISTORY_STATE_KEY],
    buffer: stored[HISTORY_BUFFER_KEY],
    lease: stored[HISTORY_LEASE_KEY],
  }
}

/**
 * Hands out the next batch under a fresh lease, or nothing while another relay holds one. Runs
 * inside the queue, so two relays asking at once are answered one after the other and only the
 * first gets visits.
 * @param {{visits: Array<{url: string, title?: string, at: string}>}} buffer - The buffer as kept
 * @param {boolean} titles - Whether titles are sent
 * @param {unknown} lease - The stored lease, of no guaranteed shape
 * @param {number} now - Current time, in ms since the epoch
 * @returns {Promise<{visits: Array<{url: string, title?: string, at: string}>, lease?: string}>} -
 *   The batch and the lease it goes under
 */
async function leaseHistoryBatch(buffer, titles, lease, now) {
  const visits = nextHistoryBatch(buffer, titles)
  if (visits.length === 0 || isHistoryLeaseHeld(lease, now)) {
    return { visits: [] }
  }

  const granted = newHistoryLease(crypto.randomUUID(), now)
  await chrome.storage.local.set({ [HISTORY_LEASE_KEY]: granted })
  return { visits, lease: granted.id }
}

/**
 * Filters a loaded page and buffers what is left of it. The raw url is judged here and never
 * stored; only its stripped form is written, and a title only while the titles switch is on and
 * the title does not repeat what the url lost.
 * @param {string} raw - Url as the browser reported it
 * @param {unknown} title - Tab title, of no guaranteed shape
 * @param {number} at - When the page finished loading, in ms since the epoch
 * @returns {Promise<unknown>} - Settles once the buffer is written, or nothing was
 */
function recordHistoryVisit(raw, title, at) {
  return serialiseHistory(async () => {
    const { target, cached, buffer } = await readHistoryStorage()
    if (!isHistoryRecording(target, cached)) {
      return
    }

    const { instances } = await readState()
    const url = acceptHistoryVisit(raw, historyFilterOf(instances, cached))
    if (!url) {
      return
    }

    const now = Date.now()
    const cleaned = target.titles === true ? cleanHistoryTitle(raw, title) : undefined
    const visit = { url, at: new Date(Math.min(at, now)).toISOString() }
    const binding = { instance: target.url, account: cached.account }
    const next = addHistoryVisit(
      readHistoryBuffer(buffer, binding, now),
      cleaned ? { ...visit, title: cleaned } : visit,
      now,
    )

    await chrome.storage.local.set({ [HISTORY_BUFFER_KEY]: next })
    scheduleHistoryNudge()
  })
}

/**
 * Takes in what a relay read from the target and answers with the first batch to send. A buffer
 * bound to another account is dropped, and so is one the instance no longer accepts, since
 * visits only wait for a server that has said yes. A lease held for another account goes with
 * its buffer.
 * @param {object} report - What the relay read, as it sent it
 * @param {string} instance - The target scope's url the relay ran inside
 * @returns {Promise<{visits: Array<{url: string, title?: string, at: string}>, lease?: string}>} -
 *   The batch and its lease, no visits while another relay holds the lease
 */
function takeHistoryReport(report, instance) {
  return serialiseHistory(async () => {
    const { target, cached, buffer, lease } = await readHistoryStorage()
    if (!target || target.url !== instance) {
      return { visits: [] }
    }

    const now = Date.now()
    const next = historyStateFromReport(cached, report, instance, now)

    if (next.account === undefined) {
      await chrome.storage.local.set({ [HISTORY_STATE_KEY]: next })
      await chrome.storage.local.remove([HISTORY_BUFFER_KEY, HISTORY_LEASE_KEY])
      return { visits: [] }
    }

    const binding = { instance, account: next.account }
    let kept = readHistoryBuffer(buffer, binding, now)
    let held = lease

    if (!cached || cached.account !== next.account) {
      held = undefined
      await chrome.storage.local.remove(HISTORY_LEASE_KEY)
    }

    if (next.signedIn && !historyAccepted(next)) {
      kept = emptyHistoryBuffer(binding)
    } else if (next.signedIn) {
      kept = excludeHistoryDomains(kept, next.excludedDomains)
    }

    await chrome.storage.local.set({ [HISTORY_STATE_KEY]: next, [HISTORY_BUFFER_KEY]: kept })
    return historyAccepted(next)
      ? leaseHistoryBatch(kept, target.titles === true, held, now)
      : { visits: [] }
  })
}

/**
 * Removes what the relay delivered and gives its lease back. While the relay still holds the
 * lease and means to post again, it is answered with the next batch under a new one; a relay
 * whose lease ran out and went to another gets nothing more.
 * @param {Array<{url: string, at: string}>} sent - The visits the delivered batch carried
 * @param {unknown} id - The lease the batch went under
 * @param {boolean} more - Whether the relay posts another batch after this one
 * @param {string} instance - The target scope's url the relay ran inside
 * @returns {Promise<{visits: Array<{url: string, title?: string, at: string}>, lease?: string}>} -
 *   The next batch and its lease
 */
function settleHistoryBatch(sent, id, more, instance) {
  return serialiseHistory(async () => {
    const { target, cached, buffer, lease } = await readHistoryStorage()
    const own = isOwnHistoryLease(lease, id)

    if (own) {
      await chrome.storage.local.remove(HISTORY_LEASE_KEY)
    }

    if (!isHistoryRecording(target, cached) || target.url !== instance) {
      return { visits: [] }
    }

    const now = Date.now()
    const binding = { instance, account: cached.account }
    const kept = settleHistoryVisits(readHistoryBuffer(buffer, binding, now), sent)

    await chrome.storage.local.set({ [HISTORY_BUFFER_KEY]: kept })
    return own && more
      ? leaseHistoryBatch(kept, target.titles === true, undefined, now)
      : { visits: [] }
  })
}

/**
 * Gives a lease back without settling anything, after a post that is to be tried again on a
 * later load.
 * @param {unknown} id - The lease the batch went under
 * @returns {Promise<unknown>} - Settles once it is removed, or was not the relay's to remove
 */
function releaseHistoryBatch(id) {
  return serialiseHistory(async () => {
    const { lease } = await readHistoryStorage()
    if (isOwnHistoryLease(lease, id)) {
      await chrome.storage.local.remove(HISTORY_LEASE_KEY)
    }
  })
}

/**
 * Sets whether page titles are recorded and sent. Switching them off also strips the titles
 * already waiting, so none leaves after the switch says none will.
 * @param {boolean} on - Whether titles go with the visits
 * @returns {Promise<unknown>} - Settles once it is written, resolving to whether a target was set
 */
function setHistoryTitles(on) {
  return serialiseHistory(async () => {
    const { target, cached, buffer } = await readHistoryStorage()
    if (!target || typeof target.url !== 'string') {
      return false
    }

    await chrome.storage.local.set({ [HISTORY_TARGET_KEY]: { ...target, titles: on } })

    if (!on && historyAccountOf(cached) !== undefined) {
      const binding = { instance: target.url, account: cached.account }
      const stripped = stripHistoryTitles(readHistoryBuffer(buffer, binding, Date.now()))
      await chrome.storage.local.set({ [HISTORY_BUFFER_KEY]: stripped })
    } else if (!on) {
      await chrome.storage.local.remove(HISTORY_BUFFER_KEY)
    }

    return true
  })
}

/**
 * Remembers that the target's address answered `/status` as something other than diele, until
 * the next report from a diele that does. The buffer waits, since a dev server without its proxy
 * or an api that is down answers the same way for a while.
 * @param {string} instance - The target scope's url the relay ran inside
 * @returns {Promise<unknown>} - Settles once it is written
 */
function markHistoryUnrecognised(instance) {
  return serialiseHistory(async () => {
    const { target, cached } = await readHistoryStorage()
    if (!target || target.url !== instance) {
      return
    }

    const known = cached !== null && typeof cached === 'object' && cached.instance === instance
    const checkedAt = new Date().toISOString()

    await chrome.storage.local.set({
      [HISTORY_STATE_KEY]: { ...(known ? cached : { instance }), unrecognised: true, checkedAt },
    })
  })
}

/**
 * Discards the buffer after the instance refused it, and remembers the refusal until the next
 * report says otherwise.
 * @param {string} instance - The target scope's url the relay ran inside
 * @returns {Promise<unknown>} - Settles once it is written
 */
function refuseHistory(instance) {
  return serialiseHistory(async () => {
    const { target, cached } = await readHistoryStorage()
    if (!target || target.url !== instance) {
      return
    }

    await chrome.storage.local.remove([HISTORY_BUFFER_KEY, HISTORY_LEASE_KEY])

    if (cached && typeof cached === 'object' && cached.instance === instance) {
      await chrome.storage.local.set({ [HISTORY_STATE_KEY]: { ...cached, refused: true } })
    }
  })
}
