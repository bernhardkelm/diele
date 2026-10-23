import { dynamicSiteLink } from '@/features/portal/dynamicTarget'
import type { SuggestionTarget } from '@/types/portal'

// Schemeless terms are only treated as urls when they end in one of these. Any suffix of
// two-plus letters would also swallow filenames typed into the field (`sites.json`,
// `App.vue`, `index.ts`), and offering to navigate to those as the auto-selected first hit
// would be worse than not offering at all. A term carrying a scheme skips this entirely.
//
// Country codes that are also common file extensions stay out for the same reason: md, py, rs,
// cc, so, ps, pl, in, am.
const TLDS = new Set([
  // generic
  'academy',
  'agency',
  'app',
  'art',
  'biz',
  'blog',
  'cloud',
  'com',
  'design',
  'dev',
  'digital',
  'edu',
  'email',
  'gov',
  'info',
  'int',
  'link',
  'live',
  'media',
  'mil',
  'name',
  'net',
  'network',
  'news',
  'one',
  'online',
  'org',
  'page',
  'pro',
  'run',
  'shop',
  'site',
  'space',
  'store',
  'studio',
  'systems',
  'tech',
  'top',
  'website',
  'wiki',
  'works',
  'world',
  'xyz',
  'zone',
  // country codes, and the ones used as generic suffixes
  'ae',
  'ai',
  'ar',
  'at',
  'au',
  'be',
  'bg',
  'br',
  'by',
  'ca',
  'ch',
  'cl',
  'cn',
  'co',
  'cz',
  'de',
  'dk',
  'ee',
  'es',
  'eu',
  'fi',
  'fm',
  'fr',
  'gg',
  'gl',
  'gr',
  'hk',
  'hr',
  'hu',
  'ie',
  'il',
  'im',
  'io',
  'is',
  'it',
  'jp',
  'kr',
  'li',
  'lt',
  'lu',
  'lv',
  'ly',
  'me',
  'ms',
  'mx',
  'nl',
  'no',
  'nz',
  'pt',
  'ro',
  'ru',
  'se',
  'sg',
  'sh',
  'si',
  'sk',
  'to',
  'tr',
  'tv',
  'tw',
  'ua',
  'uk',
  'us',
  'ws',
  'za',
  // private and local networks
  'arpa',
  'corp',
  'home',
  'internal',
  'intranet',
  'lan',
  'local',
  'localhost',
  'test',
])

// mDNS devices and loopback names rarely carry a certificate, so guessing https for them would
// offer a link that fails, the same reason localhost gets plain http.
const PLAIN_HTTP_TLDS = new Set(['local', 'localhost'])

const SCHEME = /^https?:\/\//i
// host[:port][/path], no whitespace and no scheme
const HOSTLIKE = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d{1,5})?(\/\S*)?$/i
const LOCALHOST = /^(localhost|127\.0\.0\.1)(:\d{1,5})?(\/\S*)?$/i

/**
 * Returns the registrable suffix of a host-like term.
 * @param {string} term - Term already known to look like a host
 * @returns {string} - Lowercased last label, before any port or path
 */
function tldOf(term: string): string {
  const host = term.split(/[:/]/)[0] ?? ''
  return (host.split('.').at(-1) ?? '').toLowerCase()
}

/**
 * Builds the "go to this address" entry for a term that is really a url, so a pasted link
 * opens instead of being handed to a search engine. Returns undefined for ordinary terms,
 * which is what keeps the entry from hijacking the first result on a normal search.
 * @param {string} query - Current search term
 * @returns {SuggestionTarget | undefined} - Search-only entry navigating to the url, or undefined
 */
export function pasteTargetFor(query: string): SuggestionTarget | undefined {
  const term = query.trim()
  if (!term || /\s/.test(term)) {
    return undefined
  }

  let url: string | undefined

  if (SCHEME.test(term)) {
    url = term
  } else if (LOCALHOST.test(term)) {
    url = `http://${term}`
  } else if (HOSTLIKE.test(term) && TLDS.has(tldOf(term))) {
    url = `${PLAIN_HTTP_TLDS.has(tldOf(term)) ? 'http' : 'https'}://${term}`
  }

  if (!url) {
    return undefined
  }

  // a term can still be unparseable, e.g. `https://` on its own while it is being typed
  try {
    const parsed = new URL(url)

    return dynamicSiteLink({
      name: 'Go to',
      url: parsed.href,
      display: parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname),
      adHoc: true,
    })
  } catch {
    return undefined
  }
}
