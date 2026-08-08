// Shared by the new tab page and the options page. Not a module: manifest v3 would need
// type="module" on both pages, and this is three functions.

const STORAGE_KEY = 'dieleUrl'

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
 * Returns the instance url this browser is pointed at.
 *
 * Re-validated on the way out rather than trusted: the value syncs in from other browsers and
 * from older versions of this extension, and one that no longer passes would otherwise send
 * every new tab somewhere broken with the setup form unreachable.
 * @returns {Promise<string>} - The stored url, or an empty string when unset or unusable
 */
async function readUrl() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY)
  const raw = stored[STORAGE_KEY]
  return typeof raw === 'string' ? normaliseUrl(raw) : ''
}

/**
 * Stores the instance url, syncing it to the user's other signed-in browsers.
 * @param {string} url - Url to open on every new tab, already normalised
 * @returns {Promise<void>}
 */
async function writeUrl(url) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: url })
}
