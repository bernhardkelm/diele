// The visits waiting for the next diele page load, as plain data in and out, so the worker stays
// the only place that touches storage. Every visit in here is already stripped and filtered.

// Enough for a few days offline at a normal pace; past it the oldest go first
const HISTORY_BUFFER_MAX = 500

// A week unsent means the instance is not being opened in this browser, and old visits are what
// the server would clamp or prune anyway
const HISTORY_BUFFER_MAX_AGE_MS = 7 * 24 * 60 * 60_000

// One site may hold this many, so a page that navigates itself through fresh urls, or through
// fresh subdomains of its own, cannot evict everyone else's undelivered visits or fill the buffer
// with entries it named
const HISTORY_BUFFER_MAX_PER_SITE = 25

// Second-level labels under which a country's registrable names sit one label deeper, as in
// `example.co.uk`; a stand-in for the public suffix list, which is too large to ship
const HISTORY_SECOND_LEVEL_LABELS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])

// How long a relay may take to post a batch before another relay may be handed the same one
const HISTORY_LEASE_MS = 30_000

// What the server accepts from the extension in one batch
const HISTORY_BATCH_MAX = 200

/**
 * Returns an empty buffer for an instance and an account.
 * @param {{instance: string, account: string}} binding - Who the visits belong to
 * @returns {{instance: string, account: string, visits: Array<{url: string, title?: string, at: string}>}} -
 *   The buffer
 */
function emptyHistoryBuffer(binding) {
  return { instance: binding.instance, account: binding.account, visits: [] }
}

/**
 * Approximates the site a host belongs to, the name its owner registered: the last two labels,
 * or the last three under a common second-level label such as `co.uk` or `com.au`. An ip
 * literal is a site of its own. Without the public suffix list this errs both ways, taking all
 * of a shared host like `github.io` for one site and leaving a rarer suffix such as `ne.jp` one
 * label short, which only changes whose visits share a cap.
 * @param {string} hostname - Host in comparable form, ipv6 in brackets
 * @returns {string} - The site
 */
function historySiteOf(hostname) {
  if (hostname.startsWith('[') || ipv4Octets(hostname)) {
    return hostname
  }

  const labels = hostname.split('.')
  const keep = labels.length > 2 && HISTORY_SECOND_LEVEL_LABELS.has(labels.at(-2)) ? 3 : 2

  return labels.slice(-keep).join('.')
}

/**
 * Reads the site a stored url is on.
 * @param {string} url - Url in stored form
 * @returns {string} - Its site, or an empty string when it does not parse
 */
function bufferedSite(url) {
  try {
    return historySiteOf(new URL(url).hostname)
  } catch {
    return ''
  }
}

/**
 * Keeps the visits young enough to send, newest first, no more than the cap overall and no more
 * than a site's share of it, each site losing its oldest first.
 * @param {Array<{url: string, title?: string, at: string}>} visits - Visits, any order
 * @param {number} now - Current time, in ms since the epoch
 * @returns {Array<{url: string, title?: string, at: string}>} - What is left
 */
function pruneHistoryVisits(visits, now) {
  const perSite = new Map()

  return visits
    .filter((visit) => {
      const at = Date.parse(visit.at)
      return !Number.isNaN(at) && now - at <= HISTORY_BUFFER_MAX_AGE_MS
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .filter((visit) => {
      const site = bufferedSite(visit.url)
      const count = (perSite.get(site) ?? 0) + 1

      perSite.set(site, count)
      return count <= HISTORY_BUFFER_MAX_PER_SITE
    })
    .slice(0, HISTORY_BUFFER_MAX)
}

/**
 * Reads a stored buffer for an instance and an account. One bound to anyone else is dropped
 * rather than adopted, so a profile signed in as somebody else never sends another person's
 * pages into their account.
 * @param {unknown} raw - The stored value, of no guaranteed shape
 * @param {{instance: string, account: string}} binding - Who the visits must belong to
 * @param {number} now - Current time, in ms since the epoch
 * @returns {{instance: string, account: string, visits: Array<{url: string, title?: string, at: string}>}} -
 *   The buffer, empty when nothing stored belongs to the binding
 */
function readHistoryBuffer(raw, binding, now) {
  const bound =
    raw !== null &&
    typeof raw === 'object' &&
    raw.instance === binding.instance &&
    raw.account === binding.account &&
    Array.isArray(raw.visits)

  if (!bound) {
    return emptyHistoryBuffer(binding)
  }

  const visits = raw.visits.filter(
    (visit) =>
      visit !== null &&
      typeof visit === 'object' &&
      typeof visit.url === 'string' &&
      typeof visit.at === 'string' &&
      (visit.title === undefined || typeof visit.title === 'string'),
  )

  return { ...emptyHistoryBuffer(binding), visits: pruneHistoryVisits(visits, now) }
}

/**
 * Adds a visit, folding it into one to the same url: the later time wins, and so does the later
 * title, unless the later load reported none.
 * @param {{instance: string, account: string, visits: Array<{url: string, title?: string, at: string}>}} buffer -
 *   The buffer as read
 * @param {{url: string, title?: string, at: string}} visit - The visit, stripped and filtered
 * @param {number} now - Current time, in ms since the epoch
 * @returns {{instance: string, account: string, visits: Array<{url: string, title?: string, at: string}>}} -
 *   The buffer with the visit in it
 */
function addHistoryVisit(buffer, visit, now) {
  const earlier = buffer.visits.find((entry) => entry.url === visit.url)
  const others = buffer.visits.filter((entry) => entry.url !== visit.url)
  let merged = visit

  if (earlier) {
    const newer = Date.parse(earlier.at) > Date.parse(visit.at)
    const later = newer ? earlier : visit
    const title = later.title || (newer ? visit.title : earlier.title)

    merged = { url: visit.url, at: later.at, ...(title ? { title } : {}) }
  }

  return { ...buffer, visits: pruneHistoryVisits([merged, ...others], now) }
}

/**
 * Drops visits on domains the account excluded since they were buffered.
 * @param {{instance: string, account: string, visits: Array<{url: string, title?: string, at: string}>}} buffer -
 *   The buffer as read
 * @param {string[]} excludedDomains - Domains the account never records
 * @returns {{instance: string, account: string, visits: Array<{url: string, title?: string, at: string}>}} -
 *   The buffer without them
 */
function excludeHistoryDomains(buffer, excludedDomains) {
  return {
    ...buffer,
    visits: buffer.visits.filter((visit) => !isExcludedHistoryUrl(visit.url, excludedDomains)),
  }
}

/**
 * Removes every title from the buffer, leaving the urls and times.
 * @param {{instance: string, account: string, visits: Array<{url: string, title?: string, at: string}>}} buffer -
 *   The buffer as read
 * @returns {{instance: string, account: string, visits: Array<{url: string, at: string}>}} - The
 *   buffer without titles
 */
function stripHistoryTitles(buffer) {
  return { ...buffer, visits: buffer.visits.map((visit) => ({ url: visit.url, at: visit.at })) }
}

/**
 * Picks the next batch to send, oldest first, so what is closest to ageing out goes before it
 * does. Titles go only while the switch for them is on, whatever the buffer still holds.
 * @param {{visits: Array<{url: string, title?: string, at: string}>}} buffer - The buffer as read
 * @param {boolean} titles - Whether titles are sent
 * @returns {Array<{url: string, title?: string, at: string}>} - At most one batch of visits
 */
function nextHistoryBatch(buffer, titles) {
  return [...buffer.visits]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, HISTORY_BATCH_MAX)
    .map((visit) => (titles ? visit : { url: visit.url, at: visit.at }))
}

/**
 * Removes what a batch delivered. A url loaded again after the batch left keeps its newer visit,
 * which has not been sent yet.
 * @param {{instance: string, account: string, visits: Array<{url: string, title?: string, at: string}>}} buffer -
 *   The buffer as read
 * @param {Array<{url: string, at: string}>} sent - The visits the batch carried
 * @returns {{instance: string, account: string, visits: Array<{url: string, title?: string, at: string}>}} -
 *   The buffer without them
 */
function settleHistoryVisits(buffer, sent) {
  const delivered = new Map()

  for (const visit of sent) {
    if (visit && typeof visit.url === 'string' && typeof visit.at === 'string') {
      delivered.set(visit.url, Date.parse(visit.at))
    }
  }

  return {
    ...buffer,
    visits: buffer.visits.filter(
      (visit) => !delivered.has(visit.url) || Date.parse(visit.at) > delivered.get(visit.url),
    ),
  }
}

/**
 * Returns whether a stored lease still holds the buffer. One that ran out, or names a time further
 * ahead than any lease is granted for, which only a clock set back can produce, holds nothing.
 * @param {unknown} lease - The stored lease, of no guaranteed shape
 * @param {number} now - Current time, in ms since the epoch
 * @returns {boolean} - True while a relay is posting
 */
function isHistoryLeaseHeld(lease, now) {
  return (
    lease !== null &&
    typeof lease === 'object' &&
    typeof lease.id === 'string' &&
    typeof lease.until === 'number' &&
    lease.until > now &&
    lease.until - now <= HISTORY_LEASE_MS
  )
}

/**
 * Returns whether a relay's lease is the one stored, so only its holder releases it.
 * @param {unknown} lease - The stored lease, of no guaranteed shape
 * @param {unknown} id - The lease the relay names
 * @returns {boolean} - True when the relay holds the stored lease
 */
function isOwnHistoryLease(lease, id) {
  return lease !== null && typeof lease === 'object' && typeof id === 'string' && lease.id === id
}

/**
 * Grants a lease on the next batch from now.
 * @param {string} id - A fresh random id
 * @param {number} now - Current time, in ms since the epoch
 * @returns {{id: string, until: number}} - The lease to store and hand out
 */
function newHistoryLease(id, now) {
  return { id, until: now + HISTORY_LEASE_MS }
}
