import { dynamicSiteLink } from '@/features/portal/dynamicTarget'
import type { SuggestionTarget } from '@/types/portal'

// `r/name` as reddit itself writes it, with the leading slash of a pasted path optional.
// Names are letters, digits and underscores, up to reddit's own 21 character limit.
const SUBREDDIT = /^\/?r\/([a-z0-9_]{1,21})\/?$/i

/**
 * Builds the "jump to this subreddit" entry for a term written as a subreddit path, so
 * `r/vuejs` opens the subreddit instead of being handed to a search engine. Returns
 * undefined for every other term, which is what keeps the entry out of an ordinary search.
 * @param {string} query - Current search term
 * @returns {SuggestionTarget | undefined} - Search-only entry opening the subreddit, or undefined
 */
export function subredditTargetFor(query: string): SuggestionTarget | undefined {
  const name = SUBREDDIT.exec(query.trim())?.[1]
  if (!name) {
    return undefined
  }

  return dynamicSiteLink({
    name: `r/${name}`,
    url: `https://www.reddit.com/r/${name}/`,
    display: 'reddit.com',
  })
}
