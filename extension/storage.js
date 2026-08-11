// Shared by the new tab page and the popup. Not a module: manifest v3 would need type="module"
// on both pages, and this is a handful of functions.

const INSTANCES_KEY = 'dieleInstances'
const ACTIVE_KEY = 'dieleActiveId'

// The single url older versions stored. Read so an upgrade keeps its instance, and written back
// on every change so a browser still running one of those versions keeps working.
const LEGACY_KEY = 'dieleUrl'

// chrome.storage.sync allows about 8 KB per item, which this stays far inside; the real limit is
// that a switcher longer than this is a list nobody reads.
const MAX_INSTANCES = 20

// As much of a name as a row can show before it is cut
const NAME_MAX = 32

// A scheme, but not the `host:port` that looks like one: a port is digits, and `localhost:5173`
// has to stay a host so it can be assumed https rather than parsed as a scheme called localhost.
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i

// Dot-separated labels, or a bracketed IPv6 literal. Underscores are allowed because internal
// hostnames use them, and a name that does not resolve is the user's own business.
//
// Checked instead of trusting `new URL` to throw, because it does not: a browser percent-encodes
// whatever it was given into the hostname, so `https://not a url` parses happily as the host
// `not%20a%20url`. Node's parser rejects that same string, which is the kind of difference that
// passes a test suite and ships the bug anyway.
const HOSTNAME = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$|^\[[0-9a-f:.]+\]$/i

/**
 * Normalises a typed address into a url worth storing. A bare host is assumed https, because
 * that is what anyone typing one means and the alternative is a confusing failure. Anything
 * carrying a scheme is left alone, so a wrong one is refused rather than prefixed into a
 * nonsense https url.
 * @param {string} raw - Whatever was typed into the field, or read back out of storage
 * @returns {string} - An absolute http(s) url, or an empty string when it is not one
 */
function normaliseUrl(raw) {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return ''
  }

  const candidate = SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`

  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    return ''
  }

  // Only http(s) is navigable here, and refusing everything else keeps a stored `javascript:`
  // or `data:` url from being handed to location.replace.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return ''
  }

  if (!HOSTNAME.test(parsed.hostname)) {
    return ''
  }

  return parsed.href
}

/**
 * Normalises a typed name. An empty one is allowed and normal: a row without a name shows its
 * hostname instead, so naming an instance stays optional.
 * @param {string} raw - Whatever was typed into the name field, or read back out of storage
 * @returns {string} - A trimmed name, cut to the length a row can show
 */
function normaliseName(raw) {
  return raw.trim().slice(0, NAME_MAX)
}

/**
 * Returns an identifier for a new instance. Extension pages are secure contexts, so
 * crypto.randomUUID is available.
 * @returns {string} - A uuid
 */
function createId() {
  return crypto.randomUUID()
}

/**
 * Turns whatever is under the instances key into a list worth acting on, dropping what is not.
 *
 * Nothing here is trusted: the list syncs in from other browsers and from older versions of this
 * extension, and a url that no longer validates would otherwise be handed to location.replace on
 * every new tab.
 * @param {unknown} raw - The stored value, of no guaranteed shape
 * @returns {Array<{id: string, name: string, url: string}>} - The entries that still validate
 */
function toInstances(raw) {
  if (!Array.isArray(raw)) {
    return []
  }

  const instances = []
  const seen = new Set()

  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      continue
    }

    const url = typeof entry.url === 'string' ? normaliseUrl(entry.url) : ''
    if (!url || seen.has(url)) {
      continue
    }

    seen.add(url)
    instances.push({
      id: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : createId(),
      name: typeof entry.name === 'string' ? normaliseName(entry.name) : '',
      url,
    })

    if (instances.length === MAX_INSTANCES) {
      break
    }
  }

  return instances
}

/**
 * Picks which instance is active, falling back to the first one when the stored id names an
 * entry that is gone, so a list that lost its active instance still points somewhere.
 * @param {Array<{id: string}>} instances - The validated instances
 * @param {unknown} stored - The stored active id, of no guaranteed shape
 * @returns {string} - The id of the active instance, or an empty string when there are none
 */
function resolveActiveId(instances, stored) {
  if (instances.length === 0) {
    return ''
  }

  const known = typeof stored === 'string' && instances.some((instance) => instance.id === stored)
  return known ? stored : instances[0].id
}

/**
 * Returns the instances this browser knows about and which one new tabs open.
 *
 * A url left by an older version folds in as the first instance, which covers both an upgrade in
 * place and a value syncing in later from a browser still running one. Nothing is written back
 * here, so the new tab path stays a read; the migration persists on the next change.
 * @returns {Promise<{instances: Array<{id: string, name: string, url: string}>, activeId: string}>}
 */
async function readState() {
  const stored = await chrome.storage.sync.get([INSTANCES_KEY, ACTIVE_KEY, LEGACY_KEY])
  const instances = toInstances(stored[INSTANCES_KEY])

  if (instances.length === 0) {
    const legacy = typeof stored[LEGACY_KEY] === 'string' ? normaliseUrl(stored[LEGACY_KEY]) : ''
    if (legacy) {
      instances.push({ id: createId(), name: '', url: legacy })
    }
  }

  return { instances, activeId: resolveActiveId(instances, stored[ACTIVE_KEY]) }
}

/**
 * Stores the list and the active id, syncing them to the user's other signed-in browsers. The
 * active url is mirrored into the key older versions read, so a browser still running one keeps
 * opening the same instance rather than falling back to its setup form.
 * @param {{instances: Array<{id: string, name: string, url: string}>, activeId: string}} state -
 *   The list and which of its entries new tabs open
 * @returns {Promise<{instances: Array<{id: string, name: string, url: string}>, activeId: string}>}
 */
async function writeState(state) {
  const active = state.instances.find((instance) => instance.id === state.activeId)

  await chrome.storage.sync.set({
    [INSTANCES_KEY]: state.instances,
    [ACTIVE_KEY]: state.activeId,
    [LEGACY_KEY]: active ? active.url : '',
  })

  return state
}

/**
 * Returns the url every new tab opens, which is the active instance's.
 * @returns {Promise<string>} - The active url, or an empty string when nothing is set up
 */
async function readUrl() {
  const { instances, activeId } = await readState()
  const active = instances.find((instance) => instance.id === activeId)
  return active ? active.url : ''
}

/**
 * Adds an instance. It becomes active only when it is the first, so adding a second never moves
 * the browser off the one it is pointed at.
 * @param {string} name - Name for the row, empty to show the hostname instead
 * @param {string} url - Address to add, already normalised
 * @returns {Promise<{instances: Array<{id: string, name: string, url: string}>, activeId: string}>}
 */
async function addInstance(name, url) {
  const state = await readState()
  const instance = { id: createId(), name: normaliseName(name), url }
  const instances = [...state.instances, instance]

  return writeState({
    instances,
    activeId: state.activeId || instance.id,
  })
}

/**
 * Points new tabs at another instance. An id that names nothing is ignored rather than clearing
 * the active one.
 * @param {string} id - Id of the instance to make active
 * @returns {Promise<{instances: Array<{id: string, name: string, url: string}>, activeId: string}>}
 */
async function setActiveInstance(id) {
  const state = await readState()
  if (!state.instances.some((instance) => instance.id === id)) {
    return state
  }

  return writeState({ instances: state.instances, activeId: id })
}

/**
 * Removes an instance. Removing the active one hands that role to the first survivor, so the
 * browser is never left pointed at nothing while a list remains.
 * @param {string} id - Id of the instance to remove
 * @returns {Promise<{instances: Array<{id: string, name: string, url: string}>, activeId: string}>}
 */
async function removeInstance(id) {
  const state = await readState()
  const instances = state.instances.filter((instance) => instance.id !== id)

  return writeState({ instances, activeId: resolveActiveId(instances, state.activeId) })
}
