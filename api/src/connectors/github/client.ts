// GitHub caps per_page at 100, so an owner with more repos than this needs following pages.
// The bound keeps a huge org from walking the whole instance.
const PER_PAGE = 100
const MAX_PAGES = 10

/**
 * Derives the API root from the web origin the config carries. github.com serves its API from
 * a separate host while GitHub Enterprise serves it under a path, and the config stores only
 * the web origin because every entry url comes from `html_url` in the payloads anyway.
 * @param {string} baseUrl - GitHub origin with trailing slashes already stripped
 * @returns {string} - Root every API path is appended to
 */
export function apiRootOf(baseUrl: string): string {
  return baseUrl === 'https://github.com' ? 'https://api.github.com' : `${baseUrl}/api/v3`
}

/**
 * Builds the headers every request carries. `X-GitHub-Api-Version` is deliberately left out:
 * 2022-11-28 is the default everywhere, and an older Enterprise instance rejects a version
 * header it does not know.
 * @param {string} token - Read-only access token
 * @returns {Record<string, string>} - Headers for fetch
 */
function headersFor(token: string): Record<string, string> {
  return { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` }
}

/**
 * Checks the token itself, for a connector that names no owners and so has none to check.
 * @param {string} apiRoot - API root, e.g. `https://api.github.com`
 * @param {string} token - Read-only access token
 * @param {AbortSignal} signal - Aborts the request when the check runs out of time
 * @returns {Promise<void>}
 */
export async function checkToken(
  apiRoot: string,
  token: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${apiRoot}/user`, { headers: headersFor(token), signal })

  if (response.status === 401) {
    throw new Error('the access token was rejected')
  }

  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for this token`)
  }
}

/**
 * Reads one owner's own record, which is the cheapest thing that answers both questions a save
 * needs to ask: whether the token works at all, and whether it can see this org or user.
 * `/users/:name` answers for orgs as well, so the check needs no org-or-user guess.
 * @param {string} apiRoot - API root, e.g. `https://api.github.com`
 * @param {string} owner - Org or user name as configured
 * @param {string} token - Read-only access token
 * @param {AbortSignal} signal - Aborts the request when the check runs out of time
 * @returns {Promise<void>}
 */
export async function checkOwner(
  apiRoot: string,
  owner: string,
  token: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${apiRoot}/users/${encodeURIComponent(owner)}`, {
    headers: headersFor(token),
    signal,
  })

  if (response.ok) {
    return
  }

  // The two answers worth telling apart without opening GitHub: a token that is not valid at
  // all, and one that is but cannot see this particular org or user.
  if (response.status === 401) {
    throw new Error('the access token was rejected')
  }

  if (response.status === 403 || response.status === 404) {
    throw new Error(`the org or user "${owner}" does not exist or this token cannot see it`)
  }

  throw new Error(`GitHub answered ${response.status} for "${owner}"`)
}

/**
 * Reads the login of the token's own user, so a configured owner that is the user itself can
 * be listed through `/user/repos`, the only endpoint that includes private repos of a user.
 * @param {string} apiRoot - API root, e.g. `https://api.github.com`
 * @param {string} token - Read-only access token
 * @param {AbortSignal} signal - Aborts the request when the run runs out of time
 * @returns {Promise<string>} - Login as GitHub reports it, empty when the payload carries none
 */
export async function fetchViewerLogin(
  apiRoot: string,
  token: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${apiRoot}/user`, { headers: headersFor(token), signal })

  if (response.status === 401) {
    throw new Error('the access token was rejected')
  }

  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for this token`)
  }

  const payload = (await response.json()) as { login?: string }

  return typeof payload.login === 'string' ? payload.login : ''
}

/**
 * Fetches one page of a repo listing.
 * @param {URL} url - Endpoint with its query already set, except the page number
 * @param {string} token - Read-only access token
 * @param {number} page - One-based page number
 * @param {string} subject - What to name in the error when the response is not ok
 * @param {AbortSignal} signal - Aborts the request when the run runs out of time
 * @returns {Promise<ReadonlyArray<unknown> | undefined>} - Raw repo entries, undefined on 404
 */
async function fetchPage(
  url: URL,
  token: string,
  page: number,
  subject: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<unknown> | undefined> {
  url.searchParams.set('page', String(page))

  const response = await fetch(url, { headers: headersFor(token), signal })

  if (response.status === 404) {
    return undefined
  }

  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} ${subject}`)
  }

  const payload = (await response.json()) as unknown

  return Array.isArray(payload) ? payload : []
}

/**
 * Follows one endpoint's pages until GitHub returns a short one.
 * @param {URL} url - Endpoint with its query already set, except the page number
 * @param {string} token - Read-only access token
 * @param {string} subject - What to name in the error when a response is not ok
 * @param {AbortSignal} signal - Aborts the requests when the run runs out of time
 * @returns {Promise<ReadonlyArray<unknown> | undefined>} - Entries across every page, undefined
 *   when the first page answered 404
 */
async function fetchAllPages(
  url: URL,
  token: string,
  subject: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<unknown> | undefined> {
  const collected: unknown[] = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const entries = await fetchPage(url, token, page, subject, signal)
    if (entries === undefined) {
      return page === 1 ? undefined : collected
    }

    collected.push(...entries)

    if (entries.length < PER_PAGE) {
      break
    }
  }

  return collected
}

/**
 * Builds a repo listing url with the query every listing shares. `sort=pushed` mirrors the
 * activity order the GitLab connector asks for.
 * @param {string} apiRoot - API root, e.g. `https://api.github.com`
 * @param {string} path - Endpoint path, e.g. `/orgs/example-org/repos`
 * @returns {URL} - Url ready for the page loop
 */
function listingUrl(apiRoot: string, path: string): URL {
  const url = new URL(`${apiRoot}${path}`)
  url.searchParams.set('sort', 'pushed')
  url.searchParams.set('per_page', String(PER_PAGE))

  return url
}

/**
 * Fetches every repo of one configured owner. Orgs and users share a namespace but not an
 * endpoint, so the org listing is tried first and a 404 restarts against the user listing.
 * The token's own login is the exception: `/users/:name` shows only public repos, and only
 * `/user/repos` includes the private ones, so that owner is read through it instead.
 * @param {string} apiRoot - API root, e.g. `https://api.github.com`
 * @param {string} owner - Org or user name as configured
 * @param {string} token - Read-only access token
 * @param {string} viewerLogin - Login of the token's own user
 * @param {AbortSignal} signal - Aborts the requests when the run runs out of time
 * @returns {Promise<ReadonlyArray<unknown>>} - Raw repo entries across every page
 */
export async function fetchOwnerRepos(
  apiRoot: string,
  owner: string,
  token: string,
  viewerLogin: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<unknown>> {
  const subject = `for "${owner}"`

  if (viewerLogin && owner.toLowerCase() === viewerLogin.toLowerCase()) {
    const url = listingUrl(apiRoot, '/user/repos')
    url.searchParams.set('affiliation', 'owner')

    return (await fetchAllPages(url, token, subject, signal)) ?? []
  }

  const asOrg = await fetchAllPages(
    listingUrl(apiRoot, `/orgs/${encodeURIComponent(owner)}/repos`),
    token,
    subject,
    signal,
  )
  if (asOrg !== undefined) {
    return asOrg
  }

  const asUser = await fetchAllPages(
    listingUrl(apiRoot, `/users/${encodeURIComponent(owner)}/repos`),
    token,
    subject,
    signal,
  )
  if (asUser === undefined) {
    throw new Error(`the org or user "${owner}" does not exist or this token cannot see it`)
  }

  return asUser
}

/**
 * Fetches every repo the token can see, which is what a connector with no owners named stands
 * for. The default affiliation covers owned repos, collaborations and org memberships.
 * @param {string} apiRoot - API root, e.g. `https://api.github.com`
 * @param {string} token - Read-only access token
 * @param {AbortSignal} signal - Aborts the requests when the run runs out of time
 * @returns {Promise<ReadonlyArray<unknown>>} - Raw repo entries across every page
 */
export async function fetchViewerRepos(
  apiRoot: string,
  token: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<unknown>> {
  const repos = await fetchAllPages(
    listingUrl(apiRoot, '/user/repos'),
    token,
    "listing the token's repos",
    signal,
  )
  if (repos === undefined) {
    throw new Error('the access token was rejected')
  }

  return repos
}
