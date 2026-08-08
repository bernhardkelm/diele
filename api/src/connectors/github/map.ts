import type { EntryAction } from '@diele/common'
import type { ProducedEntry } from '#connectors/types.js'

// Shape of the fields this connector reads from the repo listing endpoints. Everything is
// optional because a payload that drifts should drop a row, not throw.
interface GitHubApiRepo {
  id?: number
  name?: string
  full_name?: string
  html_url?: string
  pushed_at?: string | null
  archived?: boolean
  owner?: { login?: string }
}

/**
 * Returns the quick jumps a repo offers, GitHub's own set of the jumps GitLab rows carry. The
 * `ci` label is kept from GitLab so one search term hits both forges; `pr` is GitHub's word.
 * @param {string} url - Web url of the repo
 * @param {string} fullName - Full name, used as the default action's title
 * @returns {ReadonlyArray<EntryAction>} - Actions, the row itself first
 */
function actionsFor(url: string, fullName: string): ReadonlyArray<EntryAction> {
  return [
    { label: '', title: fullName, href: url },
    { label: 'ci', title: 'Actions', href: `${url}/actions` },
    { label: 'pr', title: 'Pull requests', href: `${url}/pulls` },
    { label: 'releases', title: 'Releases', href: `${url}/releases` },
  ]
}

/**
 * Returns the owner of a repo, preferring the login GitHub reports and falling back to the
 * leading segment of its full name.
 * @param {GitHubApiRepo} repo - Raw repo entry from the API
 * @returns {string} - Owner name, empty when neither source carries one
 */
function ownerOf(repo: GitHubApiRepo): string {
  const reported = repo.owner?.login?.trim()
  if (reported) {
    return reported
  }

  const segments = (repo.full_name ?? '').split('/')

  return segments.slice(0, -1).join('/')
}

/**
 * Narrows one raw API entry to an entry the portal renders. Entries missing an id, a full name
 * or a web url are dropped, because a row without them can neither be keyed nor opened.
 * Archived repos are dropped here because GitHub's listing endpoints, unlike GitLab's, take no
 * `archived` filter.
 * @param {unknown} entry - Single element of an API response array
 * @returns {ProducedEntry | undefined} - Mapped repo, or undefined when unusable
 */
export function mapRepo(entry: unknown): ProducedEntry | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined
  }

  const repo = entry as GitHubApiRepo
  const { id, html_url: url, full_name: fullName } = repo
  if (id === undefined || !url || !fullName) {
    return undefined
  }

  if (repo.archived === true) {
    return undefined
  }

  const name = repo.name?.trim() || (fullName.split('/').at(-1) ?? fullName)
  const owner = ownerOf(repo)
  const pushed = repo.pushed_at ?? ''

  return {
    // The numeric id rather than the full name: a repo that is renamed or transferred keeps
    // its id, and a ref built from the name would drop its launch history on every rename.
    localRef: `repo:${id}`,
    kind: 'row',
    label: name,
    detail: owner,
    url,
    keywords: [fullName],
    actions: actionsFor(url, fullName),
    // owner then name, which is the order the list rests in; the client re-sorts from there
    sortKey: `1:${owner}/${name}`,
    ...(pushed ? { timestamp: pushed } : {}),
    // lowercased, GitHub owner names are case-insensitive and config casing must still join
    parentLocalRef: `owner:${owner.toLowerCase()}`,
    healthRef: fullName,
  }
}

/**
 * Builds the entry that opens an org's or user's own GitHub page. An owner has no actions,
 * pull requests or releases of its own, so it carries only the default action.
 * @param {string} baseUrl - GitHub origin, e.g. `https://github.com`
 * @param {string} owner - Org or user name as configured
 * @returns {ProducedEntry} - Search-only row for the owner landing page
 */
export function mapOwner(baseUrl: string, owner: string): ProducedEntry {
  return {
    // lowercased for the same reason as parentLocalRef; the display fields keep the casing
    localRef: `owner:${owner.toLowerCase()}`,
    kind: 'row',
    label: owner,
    url: `${baseUrl}/${owner}`,
    keywords: [owner],
    // the `0:` prefix sorts every owner ahead of every repo, the way the list rests today
    sortKey: `0:${owner}`,
    searchOnly: true,
  }
}

/**
 * Merges the responses of every owner into one list, keyed by repo id so a repo arriving
 * twice, through a duplicated owner or the token's own listing, arrives once.
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} payloads - One parsed response per owner
 * @returns {ReadonlyArray<ProducedEntry>} - Deduplicated repos, in the order they arrived
 */
export function mergeRepos(
  payloads: ReadonlyArray<ReadonlyArray<unknown>>,
): ReadonlyArray<ProducedEntry> {
  const byRef = new Map<string, ProducedEntry>()

  for (const payload of payloads) {
    for (const entry of payload) {
      const repo = mapRepo(entry)
      if (repo && !byRef.has(repo.localRef)) {
        byRef.set(repo.localRef, repo)
      }
    }
  }

  return [...byRef.values()]
}
