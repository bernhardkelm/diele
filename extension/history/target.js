// Switching history on for one instance and off again. Both run in the worker: a permission prompt
// can close the popup that opened it, and switching on has to finish all the same.

const HISTORY_RELAY_ID = 'diele-history-relay'
const HISTORY_RELAY_FILES = ['history/relay.js', 'history/relayStart.js']

// A prompt left unanswered longer than this was abandoned, and a grant made later for some other
// reason must not switch history on
const HISTORY_PENDING_MS = 10 * 60_000

// The popup's answer and the worker's own permission listener can both switch on at once, and
// two registrations under one id would fail
let targetQueue = Promise.resolve()

/**
 * Runs a change of target after every change queued before it has settled.
 * @param {() => Promise<unknown>} task - The change
 * @returns {Promise<unknown>} - What the change resolved to
 */
function serialiseTarget(task) {
  const run = targetQueue.then(task)
  targetQueue = run.catch(() => undefined)
  return run
}

/**
 * Unregisters the relay, when it is registered and the permission to manage it is still held.
 * @returns {Promise<void>}
 */
async function unregisterHistoryRelay() {
  if (!chrome.scripting) {
    return
  }

  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [HISTORY_RELAY_ID] })
  if (registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [HISTORY_RELAY_ID] })
  }
}

/**
 * Registers the relay on the target's pages and nowhere else: its origin and path prefix, the
 * top frame only, kept across browser restarts.
 * @param {{matches: string[]}} scope - Where history goes
 * @returns {Promise<void>}
 */
async function registerHistoryRelay(scope) {
  await unregisterHistoryRelay()
  await chrome.scripting.registerContentScripts([
    {
      id: HISTORY_RELAY_ID,
      matches: scope.matches,
      js: HISTORY_RELAY_FILES,
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true,
    },
  ])
}

/**
 * Gives back every host permission but the one named, so access follows the target.
 * @param {string | undefined} keep - Host permission to keep, undefined to give back all of them
 * @returns {Promise<void>}
 */
async function releaseHistoryOrigins(keep) {
  const granted = await chrome.permissions.getAll()
  const origins = (granted.origins ?? []).filter((origin) => origin !== keep)

  if (origins.length > 0) {
    await chrome.permissions.remove({ origins })
  }
}

/**
 * Makes an instance the history target, once the permissions for it are held. Any other target
 * is switched off on the way: its relay goes, its host access goes and its buffer is dropped,
 * since those visits were meant for someone else's server.
 * @param {string} id - Id of the instance to send visits to
 * @returns {Promise<unknown>} - Resolves to what applyHistoryTarget answered
 */
function activateHistory(id) {
  return serialiseTarget(() => applyHistoryTarget(id))
}

/**
 * Does what activateHistory describes, outside the queue. When the instance cannot be the target
 * the access just granted for it is given back; when the browser fails to register the relay,
 * history is switched off entirely, so it is never left on without a way to deliver.
 * @param {string} id - Id of the instance to send visits to
 * @returns {Promise<'active' | 'refused' | 'failed'>} - Active when the instance is the target
 *   afterwards, refused when it may not be or its permissions are not held, failed when the
 *   browser refused to register the relay
 */
async function applyHistoryTarget(id) {
  const { instances } = await readState()
  const instance = instances.find((entry) => entry.id === id)
  const scope = instance ? historyScopeOf(instance.url) : undefined

  const granted =
    scope !== undefined &&
    (await chrome.permissions.contains({
      permissions: HISTORY_API_PERMISSIONS,
      origins: [scope.permission],
    }))

  if (!granted) {
    await revertHistoryGrant()
    return 'refused'
  }

  try {
    const fresh = await serialiseHistory(async () => {
      const { target } = await readHistoryStorage()
      await chrome.storage.local.remove(HISTORY_PENDING_KEY)

      if (target && target.id === id && target.url === scope.url) {
        return false
      }

      await chrome.storage.local.remove([HISTORY_STATE_KEY, HISTORY_BUFFER_KEY, HISTORY_LEASE_KEY])
      await chrome.storage.local.set({
        [HISTORY_TARGET_KEY]: { id, url: scope.url, titles: false },
      })
      return true
    })

    // A new target starts without titles, whatever the last one was allowed, and with none of
    // the last one's tabs to nudge
    if (fresh) {
      await releaseHistoryPermissions(HISTORY_TITLE_PERMISSIONS)
      await forgetRelayTabs()
    }

    await registerHistoryRelay(scope)
    await releaseHistoryOrigins(scope.permission)
  } catch {
    await clearHistoryTarget()
    return 'failed'
  }

  listenForNavigations()
  return 'active'
}

/**
 * Gives back what a prompt granted for an instance that did not become the target, and drops the
 * prompt's marker. With a target still set, only the host access beyond its own goes; without
 * one, every optional permission does, since nothing is left to use them.
 * @returns {Promise<void>}
 */
async function revertHistoryGrant() {
  const { target } = await readHistoryStorage()
  const scope = target && typeof target.url === 'string' ? historyScopeOf(target.url) : undefined

  await chrome.storage.local.remove(HISTORY_PENDING_KEY)

  if (scope) {
    await releaseHistoryOrigins(scope.permission)
    return
  }

  await releaseHistoryPermissions([...HISTORY_API_PERMISSIONS, ...HISTORY_TITLE_PERMISSIONS], true)
}

/**
 * Switches history off: recording stops, the relay goes, the buffer and the cached state are
 * cleared and every optional permission is given back. What the server already holds stays; that
 * is deleted in diele's own settings.
 * @returns {Promise<unknown>} - Settles once everything is given back
 */
function deactivateHistory() {
  return serialiseTarget(clearHistoryTarget)
}

/**
 * Does what deactivateHistory describes, outside the queue.
 * @returns {Promise<void>}
 */
async function clearHistoryTarget() {
  forgetPendingNavigations()

  await serialiseHistory(() =>
    chrome.storage.local.remove([
      HISTORY_TARGET_KEY,
      HISTORY_PENDING_KEY,
      HISTORY_STATE_KEY,
      HISTORY_BUFFER_KEY,
      HISTORY_LEASE_KEY,
    ]),
  )

  // A relay the browser cannot unregister must not keep the permissions from going back
  try {
    await forgetRelayTabs()
    await unregisterHistoryRelay()
  } finally {
    await releaseHistoryPermissions(
      [...HISTORY_API_PERMISSIONS, ...HISTORY_TITLE_PERMISSIONS],
      true,
    )
  }
}

/**
 * Gives back those of the named optional permissions that are held, and every host permission
 * when asked to.
 * @param {string[]} names - Permissions to give back
 * @param {boolean} [withOrigins] - Whether every granted origin goes too
 * @returns {Promise<void>}
 */
async function releaseHistoryPermissions(names, withOrigins = false) {
  const granted = await chrome.permissions.getAll()
  const permissions = names.filter((name) => (granted.permissions ?? []).includes(name))
  const origins = withOrigins ? (granted.origins ?? []) : []

  if (permissions.length > 0 || origins.length > 0) {
    await chrome.permissions.remove({ permissions, origins })
  }
}

/**
 * Switches page titles on for the target, once `tabs` is held. An id that is not the target's is
 * ignored, so a prompt answered after history moved elsewhere switches nothing on, and `tabs` is
 * given back unless the target already sends titles.
 * @param {string} id - Id of the instance the switch was flipped on
 * @returns {Promise<unknown>} - Resolves to true when titles are on afterwards
 */
function enableHistoryTitles(id) {
  return serialiseTarget(async () => {
    await chrome.storage.local.remove(HISTORY_PENDING_KEY)

    const { target } = await readHistoryStorage()
    const granted = await chrome.permissions.contains({ permissions: HISTORY_TITLE_PERMISSIONS })
    const mine = Boolean(target) && target.id === id

    if (granted && mine && (await setHistoryTitles(true))) {
      return true
    }

    if (!(target && target.titles === true)) {
      await releaseHistoryPermissions(HISTORY_TITLE_PERMISSIONS)
    }

    return false
  })
}

/**
 * Switches page titles off: none is recorded or sent from now on, those waiting are stripped,
 * and `tabs` is given back.
 * @returns {Promise<unknown>} - Settles once the permission is given back
 */
function disableHistoryTitles() {
  return serialiseTarget(async () => {
    await setHistoryTitles(false)
    await releaseHistoryPermissions(HISTORY_TITLE_PERMISSIONS)
  })
}

/**
 * Finishes switching on after a permission prompt the popup did not live to see answered.
 * @returns {Promise<void>}
 */
async function resumePendingHistory() {
  const stored = await chrome.storage.local.get(HISTORY_PENDING_KEY)
  const pending = stored[HISTORY_PENDING_KEY]

  const fresh =
    pending && typeof pending.at === 'number' && Date.now() - pending.at < HISTORY_PENDING_MS

  if (!fresh || typeof pending.id !== 'string') {
    return
  }

  if (pending.kind === 'titles') {
    await enableHistoryTitles(pending.id)
  } else {
    await activateHistory(pending.id)
  }
}

/**
 * Switches history off when what it depends on went away outside the popup: a permission revoked
 * in the browser's own settings, or the target removed from the list or its address changed,
 * here or on a synced browser. `tabs` revoked there switches only the titles off.
 * @returns {Promise<void>}
 */
async function checkHistoryTarget() {
  const { target } = await readHistoryStorage()
  if (!target) {
    return
  }

  const { instances } = await readState()
  const instance = instances.find((entry) => entry.id === target.id)
  const scope = instance ? historyScopeOf(instance.url) : undefined

  const granted =
    scope !== undefined &&
    scope.url === target.url &&
    (await chrome.permissions.contains({
      permissions: HISTORY_API_PERMISSIONS,
      origins: [scope.permission],
    }))

  if (!granted) {
    await deactivateHistory()
    return
  }

  const titled = await chrome.permissions.contains({ permissions: HISTORY_TITLE_PERMISSIONS })
  if (target.titles === true && !titled) {
    await disableHistoryTitles()
  }
}

/**
 * Registers the relay again for the stored target. Firefox drops registered content scripts when
 * the extension is updated or reloaded, so the worker restores it whenever it is installed or the
 * browser starts; one that is still registered is left alone. A target whose permissions are gone
 * is switched off instead.
 * @returns {Promise<void>}
 */
async function restoreHistoryRelay() {
  const { target } = await readHistoryStorage()
  if (!target) {
    return
  }

  await checkHistoryTarget()

  await serialiseTarget(async () => {
    const { target: current } = await readHistoryStorage()
    const scope = current ? historyScopeOf(current.url) : undefined

    if (!scope || !chrome.scripting) {
      return
    }

    const ids = { ids: [HISTORY_RELAY_ID] }
    const registered = await chrome.scripting.getRegisteredContentScripts(ids)

    if (registered.length === 0) {
      await registerHistoryRelay(scope)
    }
  })
}
