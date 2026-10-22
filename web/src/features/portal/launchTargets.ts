import type {
  CardTarget,
  CommandTarget,
  HistoryTarget,
  PortalTarget,
  RowTarget,
  SuggestionTarget,
} from '@/types/portal'

export interface Indexed<T> {
  /** Position in the full match list, which is what the digit shortcuts count */
  readonly index: number
  readonly item: T
}

/** The blocks the results render as, each drawn by its own list. */
export type SectionKey = 'commands' | 'suggestions' | 'cards' | 'rows' | 'history'

/** Order of the blocks on the resting page, and between two that rank the same while searching */
export const SECTION_ORDER: ReadonlyArray<SectionKey> = [
  'commands',
  'suggestions',
  'cards',
  'rows',
  'history',
]

export interface PartitionedTargets {
  readonly commands: ReadonlyArray<Indexed<CommandTarget>>
  readonly suggestions: ReadonlyArray<Indexed<SuggestionTarget>>
  readonly cards: ReadonlyArray<Indexed<CardTarget>>
  readonly rows: ReadonlyArray<Indexed<RowTarget>>
  readonly history: ReadonlyArray<Indexed<HistoryTarget>>
  /** Every block in the order the page paints it, which is the order the matches put them in */
  readonly order: ReadonlyArray<SectionKey>
}

/**
 * Returns whether a target is a saved site or another suggestion.
 * @param {PortalTarget} target - Target to test
 * @returns {boolean} - True for suggestions
 */
export function isSuggestion(target: PortalTarget): target is SuggestionTarget {
  return target.kind === 'suggestion'
}

/**
 * Returns whether a target is a list row, which is what a connector produces for a repo.
 * @param {PortalTarget} target - Target to test
 * @returns {boolean} - True for rows
 */
export function isRow(target: PortalTarget): target is RowTarget {
  return target.kind === 'row'
}

/**
 * Returns whether a target is a page this account visited before.
 * @param {PortalTarget} target - Target to test
 * @returns {boolean} - True for history entries
 */
export function isHistory(target: PortalTarget): target is HistoryTarget {
  return target.kind === 'history'
}

/**
 * Returns whether a target runs an action instead of opening a url.
 * @param {PortalTarget} target - Target to test
 * @returns {boolean} - True for commands
 */
export function isCommand(target: PortalTarget): target is CommandTarget {
  return target.kind === 'command'
}

/**
 * Returns whether a target is a logo card. It is what the digit badges count and what the
 * arrows walk as a grid.
 * @param {PortalTarget} target - Target to test
 * @returns {boolean} - True for cards
 */
export function isCard(target: PortalTarget): target is CardTarget {
  return target.kind === 'card'
}

/**
 * Returns the block a target renders in. Read off `kind` rather than off where a target came
 * from, which is what lets a second forge or a new connector land without a case of its own.
 * @param {PortalTarget} target - Target to place
 * @returns {SectionKey} - Block that draws it
 */
export function sectionKeyOf(target: PortalTarget): SectionKey {
  switch (target.kind) {
    case 'command':
      return 'commands'
    case 'suggestion':
      return 'suggestions'
    case 'card':
      return 'cards'
    case 'row':
      return 'rows'
    case 'history':
      return 'history'
  }
}

/**
 * Returns every block in the order its first match appears, then the ones nothing matched in
 * their resting order. The matches already hold each block together, so painting the blocks in
 * this order keeps what the arrows walk and what `↵` opens the order on screen.
 * @param {ReadonlyArray<PortalTarget>} matches - Current launcher matches, in order
 * @returns {ReadonlyArray<SectionKey>} - All five blocks, each once
 */
function paintOrder(matches: ReadonlyArray<PortalTarget>): ReadonlyArray<SectionKey> {
  const order = new Set<SectionKey>()

  for (const target of matches) {
    order.add(sectionKeyOf(target))
  }

  for (const key of SECTION_ORDER) {
    order.add(key)
  }

  return [...order]
}

/**
 * Splits the launcher's matches into the sections that render them, carrying each entry's
 * position in the combined list so the digit shortcuts stay continuous across all of them.
 * @param {ReadonlyArray<PortalTarget>} matches - Current launcher matches, in order
 * @returns {PartitionedTargets} - Matches grouped by section, each tagged with its index, and the order to paint them in
 */
export function partitionTargets(matches: ReadonlyArray<PortalTarget>): PartitionedTargets {
  const commands: Indexed<CommandTarget>[] = []
  const suggestions: Indexed<SuggestionTarget>[] = []
  const cards: Indexed<CardTarget>[] = []
  const rows: Indexed<RowTarget>[] = []
  const history: Indexed<HistoryTarget>[] = []

  matches.forEach((item, index) => {
    if (isCommand(item)) {
      commands.push({ index, item })
    } else if (isSuggestion(item)) {
      suggestions.push({ index, item })
    } else if (isRow(item)) {
      rows.push({ index, item })
    } else if (isHistory(item)) {
      history.push({ index, item })
    } else {
      cards.push({ index, item })
    }
  })

  return { commands, suggestions, cards, rows, history, order: paintOrder(matches) }
}
