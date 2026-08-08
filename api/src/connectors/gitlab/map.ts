import type { EntryAction } from '@diele/common'
import type { ProducedEntry } from '#connectors/types.js'

// Shape of the fields this connector reads from `GET /groups/:id/projects`. Everything is
// optional because a payload that drifts should drop a row, not throw.
interface GitLabApiProject {
  id?: number
  name?: string
  path_with_namespace?: string
  web_url?: string
  last_activity_at?: string
  namespace?: { full_path?: string }
}

/**
 * Returns the quick jumps a repo offers. Expanded here rather than templated on the wire, so
 * the client renders hrefs and never builds them, and GitHub's own set is a data change.
 * @param {string} url - Web url of the repo
 * @param {string} path - Full path, used as the default action's title
 * @returns {ReadonlyArray<EntryAction>} - Actions, the row itself first
 */
function actionsFor(url: string, path: string): ReadonlyArray<EntryAction> {
  return [
    { label: '', title: path, href: url },
    { label: 'ci', title: 'Pipelines', href: `${url}/-/pipelines` },
    { label: 'mr', title: 'Merge requests', href: `${url}/-/merge_requests` },
    { label: 'releases', title: 'Releases', href: `${url}/-/releases` },
  ]
}

/**
 * Returns the namespace of a project, preferring the one GitLab reports and falling back to
 * the leading segments of its full path.
 * @param {GitLabApiProject} project - Raw project entry from the API
 * @returns {string} - Namespace path, empty when neither source carries one
 */
function groupOf(project: GitLabApiProject): string {
  const reported = project.namespace?.full_path?.trim()
  if (reported) {
    return reported
  }

  const segments = (project.path_with_namespace ?? '').split('/')

  return segments.slice(0, -1).join('/')
}

/**
 * Narrows one raw API entry to an entry the portal renders. Entries missing an id, a path or a
 * web url are dropped, because a row without them can neither be keyed nor opened.
 * @param {unknown} entry - Single element of an API response array
 * @returns {ProducedEntry | undefined} - Mapped repo, or undefined when unusable
 */
export function mapProject(entry: unknown): ProducedEntry | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined
  }

  const project = entry as GitLabApiProject
  const { id, web_url: url, path_with_namespace: path } = project
  if (id === undefined || !url || !path) {
    return undefined
  }

  const name = project.name?.trim() || (path.split('/').at(-1) ?? path)
  const group = groupOf(project)
  const activity = project.last_activity_at ?? ''

  return {
    // The numeric id rather than the path: a repo that is renamed keeps its id, and a ref
    // built from the path would drop its launch history and health binding on every rename.
    localRef: `repo:${id}`,
    kind: 'row',
    label: name,
    detail: group,
    url,
    keywords: [path],
    actions: actionsFor(url, path),
    // group then name, which is the order the list rests in; the client re-sorts from there
    sortKey: `1:${group}/${name}`,
    ...(activity ? { timestamp: activity } : {}),
    parentLocalRef: `group:${group}`,
    healthRef: path,
  }
}

/**
 * Builds the entry that opens a group's own GitLab page, standing in for the tile that used to
 * link there. A group has no pipelines, merge requests or releases of its own, so it carries
 * only the default action.
 * @param {string} baseUrl - GitLab origin, e.g. `https://gitlab.com`
 * @param {string} group - Group path, e.g. `example-group`
 * @returns {ProducedEntry} - Search-only row for the group landing page
 */
export function mapGroup(baseUrl: string, group: string): ProducedEntry {
  return {
    localRef: `group:${group}`,
    kind: 'row',
    label: group,
    url: `${baseUrl}/${group}`,
    keywords: [group],
    // the `0:` prefix sorts every group ahead of every repo, the way the list rests today
    sortKey: `0:${group}`,
    searchOnly: true,
  }
}

/**
 * Merges the responses of every group into one list, keyed by project id so a repo shared into
 * two groups arrives once.
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} payloads - One parsed response per group
 * @returns {ReadonlyArray<ProducedEntry>} - Deduplicated repos, in the order they arrived
 */
export function mergeProjects(
  payloads: ReadonlyArray<ReadonlyArray<unknown>>,
): ReadonlyArray<ProducedEntry> {
  const byRef = new Map<string, ProducedEntry>()

  for (const payload of payloads) {
    for (const entry of payload) {
      const project = mapProject(entry)
      if (project && !byRef.has(project.localRef)) {
        byRef.set(project.localRef, project)
      }
    }
  }

  return [...byRef.values()]
}
