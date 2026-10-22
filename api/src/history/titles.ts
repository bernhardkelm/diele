import { createHash } from 'node:crypto'
import { parseVisitUrl } from './normalise.js'
import { titleLeaksUrl } from './titleLeaks.js'

/** Longer than any title a tab shows, and enough to keep a pasted essay out of the column. */
export const MAX_TITLE = 300

/**
 * Cleans a reported title. A title is rendered in the search, so what can make it read as
 * something else goes: control characters become spaces, and format characters (direction marks
 * and overrides, zero-width characters, the byte order mark, tag characters) are removed. Then
 * whitespace is collapsed and the length capped.
 * @param {string | undefined} raw - Title as the source reported it
 * @returns {string | undefined} - The title to store, or undefined when nothing is left
 */
export function cleanTitle(raw: string | undefined): string | undefined {
  const title = raw
    ?.replace(/\p{Cc}/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE)
    .trim()

  return title ? title : undefined
}

/**
 * Digests a title for the shell-page count, which only has to tell titles apart and so has no
 * reason to keep what they said.
 * @param {string} title - Title, already cleaned
 * @returns {string} - A short digest
 */
export function titleHash(title: string): string {
  return createHash('sha256').update(title).digest('base64url').slice(0, 22)
}

/**
 * Decides which title a reported visit is stored with: the cleaned title, unless it gives away
 * the query or fragment the stored url leaves out, or is only the address. A page script can post
 * as the extension as well as the extension can, so a forged batch is held to the same rule.
 * @param {string | undefined} raw - Title as the source reported it
 * @param {string} url - Url as the source reported it, query and fragment intact
 * @returns {string | undefined} - The title to store, or undefined when none is kept
 */
export function titleToStore(raw: string | undefined, url: string): string | undefined {
  const title = cleanTitle(raw)
  const parsed = title === undefined ? undefined : parseVisitUrl(url)

  return title !== undefined && parsed && !titleLeaksUrl(title, parsed) ? title : undefined
}
