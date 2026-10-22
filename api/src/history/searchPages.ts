import { hostnameOf } from './normalise.js'

/** What a template's `{query}` is swapped for, so the URL parser can read the rest of it. */
const SENTINEL = 'diele-query-placeholder'

/** Parameters a results page on a path ending in `/search` carries its term in. */
const SEARCH_PARAMS = ['q', 'query', 'search']

/**
 * Returns whether a host is the site itself or one of its subdomains.
 * @param {string} hostname - Host to test
 * @param {string} site - Registrable name, such as `youtube.com`
 * @returns {boolean} - True when the host belongs to the site
 */
function onSite(hostname: string, site: string): boolean {
  return hostname === site || hostname.endsWith(`.${site}`)
}

/**
 * Returns whether a host is one of Google's country sites.
 * @param {string} hostname - Host to test
 * @returns {boolean} - True for google.com, google.de, www.google.co.uk and the like
 */
function isGoogle(hostname: string): boolean {
  return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(hostname)
}

/**
 * Returns whether a url is the results page of a well-known search, wherever diele has not been
 * told about it. The `/search` rule holds on any host on purpose: it is how Google, Bing, Kagi
 * and Ecosia write theirs, and how a self-hosted GitHub or GitLab does.
 * @param {URL} url - Url as reported, query intact
 * @returns {boolean} - True for a results page
 */
export function isBuiltInSearchPage(url: URL): boolean {
  const params = url.searchParams
  const last = url.pathname.replace(/\/+$/, '').split('/').at(-1)?.toLowerCase()

  if (last === 'search' && SEARCH_PARAMS.some((name) => params.has(name))) {
    return true
  }

  // Everything below `/maps/` is a place, a route or a search, which is to say where someone was
  // looking: the stock `/maps` command writes its term into exactly this path.
  if (isGoogle(url.hostname) && url.pathname.startsWith('/maps/')) {
    return true
  }

  if (url.hostname.startsWith('maps.google.') && url.pathname !== '/') {
    return true
  }

  if (onSite(url.hostname, 'duckduckgo.com') && params.has('q')) {
    return true
  }

  if (onSite(url.hostname, 'youtube.com') && url.pathname === '/results') {
    return params.has('search_query')
  }

  if (onSite(url.hostname, 'startpage.com') && /search/i.test(url.pathname)) {
    return params.has('query') || params.has('q')
  }

  return false
}

/**
 * Returns whether a url's host is the template's host or below it, a leading `www.` ignored on
 * both, so `www.reddit.com/r/{query}` also covers `reddit.com` and `old.reddit.com`. The port has
 * to agree; the scheme does not, since a results page is one over http and https alike.
 * @param {URL} url - Url as reported
 * @param {URL} pattern - The template, parsed
 * @returns {boolean} - True when the url is on the template's site
 */
function onTemplateHost(url: URL, pattern: URL): boolean {
  const base = hostnameOf(pattern).replace(/^www\./, '')
  const host = hostnameOf(url).replace(/^www\./, '')

  return url.port === pattern.port && (host === base || host.endsWith(`.${base}`))
}

/**
 * Returns whether a url is what one of diele's own engines or slash commands submits a term to.
 * A template carries `{query}` either as a parameter's value, which matches the same site and
 * path with that parameter present, or inside its path, which matches anything below the part
 * before it.
 * @param {URL} url - Url as reported, query intact
 * @param {string} template - An engine's or a slash command's url template
 * @returns {boolean} - True when the url is that template's results page
 */
export function matchesEngine(url: URL, template: string): boolean {
  let pattern: URL

  try {
    pattern = new URL(template.replaceAll('{query}', SENTINEL))
  } catch {
    return false
  }

  if (!onTemplateHost(url, pattern)) {
    return false
  }

  for (const [name, value] of pattern.searchParams) {
    if (value.includes(SENTINEL)) {
      return url.pathname === pattern.pathname && url.searchParams.has(name)
    }
  }

  const at = pattern.pathname.indexOf(SENTINEL)
  if (at < 0) {
    return false
  }

  const prefix = pattern.pathname.slice(0, at)

  return url.pathname.startsWith(prefix) && url.pathname.length > prefix.length
}

/**
 * Returns whether a url is a page of search results, which says what someone looked for and is
 * the one thing a search field should never offer back as a place.
 * @param {URL} url - Url as reported, query intact
 * @param {ReadonlyArray<string>} templates - Url templates of the configured engines and slash commands
 * @returns {boolean} - True for a results page
 */
export function isSearchPage(url: URL, templates: ReadonlyArray<string>): boolean {
  return isBuiltInSearchPage(url) || templates.some((template) => matchesEngine(url, template))
}
