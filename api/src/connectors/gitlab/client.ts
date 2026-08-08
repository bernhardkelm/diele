// The same query the nginx proxy this replaces sent, so behaviour does not drift as it moves:
// subgroups included, archived repos left out, ordered by activity.
const PER_PAGE = 100

// GitLab caps per_page at 100, so a group with more repos than this needs following pages. The
// bound keeps a misconfigured group from walking a whole instance.
const MAX_PAGES = 10

/**
 * Lists the top-level groups the token can see, which is what a connector with no groups named
 * stands for. Top level only: subgroups arrive through `include_subgroups` on each one, and
 * listing them here as well would fetch every repo twice.
 * @param {string} baseUrl - GitLab origin, e.g. `https://gitlab.com`
 * @param {string} token - Read-only access token
 * @param {AbortSignal} signal - Aborts the request when the run runs out of time
 * @returns {Promise<ReadonlyArray<string>>} - Group paths, in the order GitLab returned them
 */
export async function fetchVisibleGroups(
  baseUrl: string,
  token: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<string>> {
  const url = new URL(`${baseUrl}/api/v4/groups`)
  // Reporter and above, so a group someone can only see the name of does not turn into a
  // section that is always empty.
  url.searchParams.set('min_access_level', '20')
  url.searchParams.set('top_level_only', 'true')
  url.searchParams.set('per_page', String(PER_PAGE))

  const response = await fetch(url, {
    headers: { accept: 'application/json', 'PRIVATE-TOKEN': token },
    signal,
  })

  if (!response.ok) {
    throw new Error(`GitLab answered ${response.status} listing the token's groups`)
  }

  const payload = (await response.json()) as unknown
  if (!Array.isArray(payload)) {
    return []
  }

  return payload
    .map((entry) => (entry as { full_path?: string }).full_path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
}

/**
 * Checks the token itself, for a connector that names no groups and so has none to check.
 * @param {string} baseUrl - GitLab origin, e.g. `https://gitlab.com`
 * @param {string} token - Read-only access token
 * @param {AbortSignal} signal - Aborts the request when the check runs out of time
 * @returns {Promise<void>}
 */
export async function checkToken(
  baseUrl: string,
  token: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v4/user`, {
    headers: { accept: 'application/json', 'PRIVATE-TOKEN': token },
    signal,
  })

  if (response.status === 401) {
    throw new Error('the access token was rejected')
  }

  if (!response.ok) {
    throw new Error(`GitLab answered ${response.status} for this token`)
  }
}

/**
 * Reads one group's own record, which is the cheapest thing that answers both questions a save
 * needs to ask: whether the token works at all, and whether it can see this group.
 * @param {string} baseUrl - GitLab origin, e.g. `https://gitlab.com`
 * @param {string} group - Group path as configured
 * @param {string} token - Read-only access token
 * @param {AbortSignal} signal - Aborts the request when the check runs out of time
 * @returns {Promise<void>}
 */
export async function checkGroup(
  baseUrl: string,
  group: string,
  token: string,
  signal: AbortSignal,
): Promise<void> {
  const url = new URL(`${baseUrl}/api/v4/groups/${encodeURIComponent(group)}`)
  url.searchParams.set('with_projects', 'false')

  const response = await fetch(url, {
    headers: { accept: 'application/json', 'PRIVATE-TOKEN': token },
    signal,
  })

  if (response.ok) {
    return
  }

  // The two answers worth telling apart without opening GitLab: a token that is not valid at
  // all, and one that is but cannot see this particular group.
  if (response.status === 401) {
    throw new Error('the access token was rejected')
  }

  if (response.status === 403 || response.status === 404) {
    throw new Error(`the group "${group}" does not exist or this token cannot see it`)
  }

  throw new Error(`GitLab answered ${response.status} for group "${group}"`)
}

/**
 * Fetches one page of a group's projects.
 * @param {string} baseUrl - GitLab origin, e.g. `https://gitlab.com`
 * @param {string} group - Group path as configured
 * @param {string} token - Read-only access token
 * @param {boolean} includeSubgroups - Whether repos of nested groups are listed too
 * @param {number} page - One-based page number
 * @param {AbortSignal} signal - Aborts the request when the run runs out of time
 * @returns {Promise<ReadonlyArray<unknown>>} - Raw project entries, narrowed by the mapper
 */
async function fetchPage(
  baseUrl: string,
  group: string,
  token: string,
  includeSubgroups: boolean,
  page: number,
  signal: AbortSignal,
): Promise<ReadonlyArray<unknown>> {
  const url = new URL(`${baseUrl}/api/v4/groups/${encodeURIComponent(group)}/projects`)
  url.searchParams.set('include_subgroups', String(includeSubgroups))
  url.searchParams.set('archived', 'false')
  url.searchParams.set('per_page', String(PER_PAGE))
  url.searchParams.set('order_by', 'last_activity_at')
  url.searchParams.set('page', String(page))

  const response = await fetch(url, {
    headers: { accept: 'application/json', 'PRIVATE-TOKEN': token },
    signal,
  })

  if (!response.ok) {
    // 401 is an expired or revoked token and 404 is a group this token cannot see, which are
    // the two failures worth telling apart without opening GitLab.
    throw new Error(`GitLab answered ${response.status} for group "${group}"`)
  }

  const payload = (await response.json()) as unknown

  return Array.isArray(payload) ? payload : []
}

/**
 * Fetches every project of one group, following pages until GitLab returns a short one.
 * @param {string} baseUrl - GitLab origin, e.g. `https://gitlab.com`
 * @param {string} group - Group path as configured
 * @param {string} token - Read-only access token
 * @param {boolean} includeSubgroups - Whether repos of nested groups are listed too
 * @param {AbortSignal} signal - Aborts the requests when the run runs out of time
 * @returns {Promise<ReadonlyArray<unknown>>} - Raw project entries across every page
 */
export async function fetchGroupProjects(
  baseUrl: string,
  group: string,
  token: string,
  includeSubgroups: boolean,
  signal: AbortSignal,
): Promise<ReadonlyArray<unknown>> {
  const collected: unknown[] = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const entries = await fetchPage(baseUrl, group, token, includeSubgroups, page, signal)
    collected.push(...entries)

    if (entries.length < PER_PAGE) {
      break
    }
  }

  return collected
}
