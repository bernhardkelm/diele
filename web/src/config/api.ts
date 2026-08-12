// Same-origin paths served by portal-api: nginx proxies them in the cluster and the vite dev
// server proxies them locally, so the session cookie is a first-party cookie either way and
// no CORS is involved.
export const CONFIG_URL = '/api/config'
export const AUTH_ME_URL = '/api/auth/me'
export const AUTH_PROVIDERS_URL = '/api/auth/providers'
export const AUTH_LOGOUT_URL = '/api/auth/logout'
export const AUTH_LOGOUT_ALL_URL = '/api/auth/logout-all'
export const AUTH_LOGIN_URL = '/api/auth/login'
export const AUTH_SETUP_URL = '/api/auth/setup'

/**
 * Builds the login url, carrying where the browser should land afterwards.
 *
 * Only the redirecting modes use it: a password login posts to the same path instead, which is
 * why this one is a url builder and that one is a plain constant.
 * @param {string} redirectTo - Same-origin path to return to after signing in
 * @param {boolean} remember - Whether to ask for the longer session
 * @returns {string} - Url to navigate to
 */
export function authLoginUrl(redirectTo: string, remember = false): string {
  const query = new URLSearchParams({ redirect: redirectTo })
  if (remember) {
    query.set('remember', '1')
  }

  return `${AUTH_LOGIN_URL}?${query.toString()}`
}

// Connector-produced entries, served from the API's own cache so this is a local read there
// rather than a trip to GitLab. Separate from the config because config changes only when
// someone edits it, and folding entries in would bust its etag on every sync.
export const ENTRIES_URL = '/api/entries'
export const ENTRIES_HIDDEN_URL = '/api/entries/hidden'

// How each bound entry last answered, resolved by the API rather than here: a probe run from the
// browser reads an opaque response whose status is 0, so a 200 and a login redirect look alike.
// Separate from the entries for the same reason those are separate from the config: a reading
// changes on every refresh and would bust that payload's etag.
export const HEALTH_URL = '/api/health'

// What the connected sources report as firing. Its own document rather than part of the readings
// above: the two carry their own switches, and a signal belongs to no entry to be keyed by.
export const SIGNALS_URL = '/api/signals'

// Quietens one alert for this portal rather than in the source: who is asking decides whether
// that means the whole portal or only their own account.
export const SIGNALS_SILENCE_URL = '/api/signals/silence'

export const ADMIN_FEATURES_URL = '/api/admin/features'
export const ADMIN_ICONS_URL = '/api/admin/icons'
export const ADMIN_EXPORT_URL = '/api/admin/export'
export const ADMIN_IMPORT_URL = '/api/admin/import'

// Every other admin collection url arrives on its feature as `collection`, so adding one is a
// server change alone. Only the endpoints that are not a feature's rows are named here.

/**
 * Builds the path that turns a whole feature on or off.
 * @param {string} featureId - Feature to toggle
 * @returns {string} - Same-origin url for its switch
 */
export function adminFeatureEnabledUrl(featureId: string): string {
  return `/api/admin/features/${encodeURIComponent(featureId)}/enabled`
}

// What the last visit saw is painted immediately and revalidated in the background, so the
// portal never waits on the network to draw a new tab.
// Versioned: an entry written by an older build has an older shape, and bumping the key
// retires it outright rather than leaving the reader to patch around missing fields.
export const CONFIG_CACHE_KEY = 'diele:config:v1'
export const CONFIG_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60_000

export const ENTRIES_CACHE_KEY = 'diele:entries:v1'
export const ENTRIES_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000
