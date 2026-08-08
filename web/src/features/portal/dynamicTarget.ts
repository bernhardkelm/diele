import type { SuggestionTarget } from '@/types/portal'

/**
 * Builds a target the launcher makes up from the term rather than one the portal has saved.
 *
 * `searchOnly` and the empty keyword list are the point of the constructor: a made-up target
 * must never stand on the resting page, and must never match anything but the term that
 * produced it. Both were written out by hand at each site before, which is one edit away from
 * a target that quietly stays on screen after the term that built it is gone.
 *
 * The ref is built from the url, which is the only identity a target nothing stored has.
 * @param {object} fields - What the term produced: how the entry reads, where it goes, and whether opening it is worth recording
 * @returns {SuggestionTarget} - Search-only entry for this term
 */
export function dynamicSiteLink(fields: {
  name: string
  url: string
  /** Second column text, the host or wherever the entry actually leads */
  display: string
  /** Records the host in the visited list when opened, for a target built from a typed url */
  adHoc?: true
}): SuggestionTarget {
  return {
    ref: `adhoc:${fields.url}`,
    kind: 'suggestion',
    keywords: [],
    searchOnly: true,
    ...fields,
  }
}
