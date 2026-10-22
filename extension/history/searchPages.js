// A results page is told apart by its query, which is gone once a url is stripped, so this has to
// be decided here, before anything is stored. Keeping the search would keep what someone looked
// for, the one thing a search field should never offer back as a place.

// What a template's `{query}` is swapped for, so the URL parser can read the rest of it
const SEARCH_SENTINEL = 'diele-query-placeholder'

// Parameters a results page on a path ending in `/search` carries its term in
const SEARCH_PARAMS = ['q', 'query', 'search']

/**
 * Returns whether a host is the site itself or one of its subdomains.
 * @param {string} hostname - Host to test
 * @param {string} site - Registrable name, such as `youtube.com`
 * @returns {boolean} - True when the host belongs to the site
 */
function isOnSite(hostname, site) {
  return hostname === site || hostname.endsWith(`.${site}`)
}

/**
 * Returns whether a url is the results page of a well-known search. The `/search` rule holds on
 * any host on purpose: it is how Google, Bing, Kagi and Ecosia write theirs, and how a
 * self-hosted GitHub or GitLab does.
 * @param {URL} url - Url as loaded, query intact
 * @returns {boolean} - True for a results page
 */
function isBuiltInSearchPage(url) {
  const params = url.searchParams
  const host = url.hostname
  const last = url.pathname.replace(/\/+$/, '').split('/').at(-1)?.toLowerCase()

  if (last === 'search' && SEARCH_PARAMS.some((name) => params.has(name))) {
    return true
  }

  // Everything below `/maps/` is a place, a route or a search, which is where someone was looking
  if (/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) && url.pathname.startsWith('/maps/')) {
    return true
  }

  if (host.startsWith('maps.google.') && url.pathname !== '/') {
    return true
  }

  if (isOnSite(host, 'duckduckgo.com') && params.has('q')) {
    return true
  }

  if (isOnSite(host, 'youtube.com') && url.pathname === '/results') {
    return params.has('search_query')
  }

  if (isOnSite(host, 'startpage.com') && /search/i.test(url.pathname)) {
    return params.has('query') || params.has('q')
  }

  return false
}

/**
 * Reduces an engine's or a slash command's template to what telling its results page apart
 * takes: the host, the port, and either the path with the name of the parameter that carries the
 * term, or the part of the path before the term. Nothing else of the template is kept, since a
 * template can carry a key in its other parameters and this is written to storage.
 * @param {string} template - Url template, with `{query}` standing in for the term
 * @returns {{host: string, port: string, path: string, param?: string, prefix?: string} | undefined} -
 *   The pattern, or undefined when the template names no place for the term
 */
function compileSearchTemplate(template) {
  let pattern

  try {
    pattern = new URL(template.replaceAll('{query}', SEARCH_SENTINEL))
  } catch {
    return undefined
  }

  const host = pattern.hostname.replace(/\.+$/, '').replace(/^www\./, '')
  const base = { host, port: pattern.port }

  for (const [name, value] of pattern.searchParams) {
    if (value.includes(SEARCH_SENTINEL)) {
      return { ...base, path: pattern.pathname, param: name }
    }
  }

  const at = pattern.pathname.indexOf(SEARCH_SENTINEL)
  return at < 0 ? undefined : { ...base, path: '', prefix: pattern.pathname.slice(0, at) }
}

/**
 * Keeps the patterns of a list that have the shape compileSearchTemplate gives them.
 * @param {unknown} raw - A stored list, of no guaranteed shape
 * @returns {Array<{host: string, port: string, path: string, param?: string, prefix?: string}>} -
 *   The patterns in it
 */
function searchPatternsOf(raw) {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .filter(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.host === 'string' &&
        typeof entry.port === 'string' &&
        typeof entry.path === 'string' &&
        (typeof entry.param === 'string' || typeof entry.prefix === 'string'),
    )
    .slice(0, 500)
    .map(({ host, port, path, param, prefix }) =>
      typeof param === 'string' ? { host, port, path, param } : { host, port, path, prefix },
    )
}

/**
 * Returns whether a url is what one of the instance's engines or slash commands submits a term
 * to: on the pattern's host or below it, a leading `www.` ignored, with the parameter that
 * carries the term present, or below the part of the path before it. A term right after the
 * root, as in `https://github.com/{query}`, would take every page of its site with it that way,
 * so such a pattern matches only a path of exactly one segment, on the pattern's own host and no
 * other subdomain.
 * @param {URL} url - Url as loaded, query intact
 * @param {{host: string, port: string, path: string, param?: string, prefix?: string}} pattern -
 *   A compiled template
 * @returns {boolean} - True when the url is that template's results page
 */
function matchesSearchPattern(url, pattern) {
  const host = url.hostname.replace(/\.+$/, '').replace(/^www\./, '')
  const root = pattern.prefix === '/'
  const below = !root && host.endsWith(`.${pattern.host}`)

  if (url.port !== pattern.port || (host !== pattern.host && !below)) {
    return false
  }

  if (root) {
    return /^\/[^/]+\/?$/.test(url.pathname)
  }

  if (typeof pattern.param === 'string') {
    return url.pathname === pattern.path && url.searchParams.has(pattern.param)
  }

  return url.pathname.startsWith(pattern.prefix) && url.pathname.length > pattern.prefix.length
}

/**
 * Returns whether a url is a page of search results.
 * @param {URL} url - Url as loaded, query intact
 * @param {Array<{host: string, port: string, path: string, param?: string, prefix?: string}>} patterns -
 *   The instance's engines and slash commands, compiled
 * @returns {boolean} - True for a results page
 */
function isSearchPage(url, patterns) {
  return isBuiltInSearchPage(url) || patterns.some((pattern) => matchesSearchPattern(url, pattern))
}
