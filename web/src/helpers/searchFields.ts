import type { PortalTarget } from '@/types/portal'

export interface SearchField {
  readonly text: string
  /** Multiplier on the field's score, so a name outranks the host it happens to sit on */
  readonly weight: number
}

const NAME = 1
const PATH = 0.9
const KEYWORD = 0.85
const CAPTION = 0.6
// low enough that a term hitting nothing but a shared domain sorts under every real match
const HOST = 0.45

/**
 * Returns the host a url points at, without the `www.` nobody types.
 * @param {string} url - Absolute url of a target
 * @returns {string} - Host including its port, empty when the url is unparseable
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Returns the texts a target is searched over, each weighted by how much a hit on it says.
 * Matching the fields rather than the whole url is what keeps `lab` or `com` from matching
 * every repo through the `gitlab.com` they all share.
 * @param {PortalTarget} target - Target to describe
 * @returns {ReadonlyArray<SearchField>} - Weighted fields, the name first
 */
export function fieldsFor(target: PortalTarget): ReadonlyArray<SearchField> {
  const fields: SearchField[] = [{ text: target.name, weight: NAME }]

  if (target.kind === 'row' && target.detail) {
    // every repo sits on the same host, so only the namespace says which one this is
    fields.push({ text: target.detail, weight: PATH })
  }

  if (target.kind === 'command') {
    fields.push({ text: target.hint, weight: CAPTION })
  }

  if (target.kind === 'suggestion' && target.display) {
    fields.push({ text: target.display, weight: CAPTION })
  }

  for (const keyword of target.keywords ?? []) {
    if (keyword) {
      fields.push({ text: keyword, weight: KEYWORD })
    }
  }

  // Cards and rows sit on a handful of shared domains, so a term hitting one would raise every
  // card or every repo at once. Only a suggestion is worth finding by its host.
  if (target.kind !== 'suggestion') {
    return fields
  }

  const host = hostOf(target.url)
  if (host) {
    fields.push({ text: host, weight: HOST })
  }

  return fields
}
