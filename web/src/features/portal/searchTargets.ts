import { scoreFields } from '@/helpers/scoreFields'
import { fieldsFor } from '@/helpers/searchFields'
import { tokenize } from '@/helpers/searchTokens'
import type { PortalTarget } from '@/types/portal'

/**
 * Returns the section a target renders in. Ranking only ever reorders within one of these, so
 * the match order the arrow keys walk stays the order the page paints.
 *
 * Read off `kind` rather than off where a target came from, which is what lets a second forge
 * or a new connector land without a case of its own here.
 * @param {PortalTarget} target - Target to place
 * @returns {number} - Section rank, ascending in render order
 */
function sectionOf(target: PortalTarget): number {
  switch (target.kind) {
    case 'command':
      return 0
    case 'suggestion':
      return 1
    case 'card':
      return 2
    default:
      // a group page leads its own repos, the way it does without a term
      return target.searchOnly ? 3 : 4
  }
}

/**
 * Filters the launch targets down to what a query matches and orders them by how well,
 * best first within each section.
 * @param {ReadonlyArray<T>} targets - Every target the launcher can reach
 * @param {string} query - Raw search term as typed
 * @param {(target: T) => number} boostFor - Extra score a target has earned, e.g. from being opened before
 * @returns {ReadonlyArray<T>} - Matching targets, ranked
 */
export function searchTargets<T extends PortalTarget>(
  targets: ReadonlyArray<T>,
  query: string,
  boostFor?: (target: T) => number,
): ReadonlyArray<T> {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return targets
  }

  const ranked: Array<{ target: T; section: number; score: number; order: number }> = []

  targets.forEach((target, order) => {
    const score = scoreFields(fieldsFor(target), tokens)
    if (score === undefined) {
      return
    }

    ranked.push({
      target,
      section: sectionOf(target),
      score: score + (boostFor?.(target) ?? 0),
      order,
    })
  })

  ranked.sort((a, b) => a.section - b.section || b.score - a.score || a.order - b.order)

  return ranked.map((entry) => entry.target)
}
