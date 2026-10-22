import { SECTION_ORDER, sectionKeyOf, type SectionKey } from '@/features/portal/launchTargets'
import { byRank, scoreItems, type ScoredItem } from '@/helpers/rankByScore'
import { fieldsFor } from '@/helpers/searchFields'
import type { PortalTarget } from '@/types/portal'

// Added to a block's best score to rank it among the others, so on a tie or a near tie what the
// portal was told about wins over a page merely visited. The smallest, 125, is more than the 100 a
// tier step is worth, and the cards' 150 is what a keyword's weight takes off an exact hit, so an
// equal-tier match in a known block stays above history. The largest stays under the 200 between
// a typo's best (249) and a substring's least (449), so a history hit two tiers better still
// clears every known block.
const SECTION_PRIORS: Readonly<Record<SectionKey, number>> = {
  commands: 175,
  suggestions: 175,
  cards: 150,
  rows: 125,
  history: 0,
}

interface RankedSection<T> {
  readonly key: SectionKey
  readonly rank: number
  readonly entries: ReadonlyArray<ScoredItem<T>>
}

/**
 * Returns where a target sits among the others of its block before its score is read: a group
 * page leads its own repos, the way it does without a term.
 * @param {PortalTarget} target - Target to place
 * @returns {number} - 0 for a group page, 1 for everything else
 */
function leadOf(target: PortalTarget): number {
  return target.kind === 'row' && target.searchOnly ? 0 : 1
}

/**
 * Orders the entries of one block: group pages first, then by score with the boost, then in
 * source order.
 * @param {ScoredItem<T>} a - One entry
 * @param {ScoredItem<T>} b - The other
 * @returns {number} - Negative when `a` goes first
 */
function withinSection<T extends PortalTarget>(a: ScoredItem<T>, b: ScoredItem<T>): number {
  return leadOf(a.item) - leadOf(b.item) || byRank(a, b)
}

/**
 * Groups the scored targets into their blocks and ranks each block by its best score plus its
 * prior. The boost is left out of that rank: it breaks ties inside a list, and habit alone must
 * not carry a whole block over a better one. A block holding a target made up from the term
 * leads, since a term that produced one is a stronger signal than anything it merely matched.
 * @param {ReadonlyArray<ScoredItem<T>>} scored - Targets the query matched
 * @param {ReadonlySet<SectionKey>} leading - Blocks holding a target made up from the term
 * @returns {ReadonlyArray<RankedSection<T>>} - Blocks, best first
 */
function rankSections<T extends PortalTarget>(
  scored: ReadonlyArray<ScoredItem<T>>,
  leading: ReadonlySet<SectionKey>,
): ReadonlyArray<RankedSection<T>> {
  const sections = SECTION_ORDER.map((key) => {
    const entries = scored.filter((entry) => sectionKeyOf(entry.item) === key)
    const best = Math.max(...entries.map((entry) => entry.score))
    const rank = leading.has(key) ? Number.POSITIVE_INFINITY : best + SECTION_PRIORS[key]

    return { key, rank, entries: [...entries].sort(withinSection) }
  }).filter((section) => section.entries.length > 0 || leading.has(section.key))

  // a stable sort, so two blocks of equal rank keep their resting order
  return sections.sort((a, b) => (a.rank === b.rank ? 0 : b.rank - a.rank))
}

/**
 * Filters the launch targets down to what a query matches and orders them by how well. Each
 * block stays whole, since the page draws it as one list or one grid, and the blocks follow one
 * another by rank rather than in a fixed order, so a visited page that is plainly what the term
 * meant leads the page instead of trailing ten weak repos.
 * @param {ReadonlyArray<T>} targets - Every target the launcher can reach
 * @param {string} query - Raw search term as typed
 * @param {(target: T) => number} [boostFor] - Extra score a target has earned, e.g. from being opened before
 * @param {ReadonlyArray<T>} [leading] - Targets made up from the term, first in their block
 * @returns {ReadonlyArray<T>} - Matching targets, block by block; the targets untouched for a blank query
 */
export function searchTargets<T extends PortalTarget>(
  targets: ReadonlyArray<T>,
  query: string,
  boostFor?: (target: T) => number,
  leading: ReadonlyArray<T> = [],
): ReadonlyArray<T> {
  const scored = scoreItems(targets, query, fieldsFor, { boostFor })
  if (!scored) {
    return targets
  }

  const leadingKeys = new Set(leading.map(sectionKeyOf))

  return rankSections(scored, leadingKeys).flatMap((section) => [
    ...leading.filter((target) => sectionKeyOf(target) === section.key),
    ...section.entries.map((entry) => entry.item),
  ])
}
