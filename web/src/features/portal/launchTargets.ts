import type {
  CardTarget,
  CommandTarget,
  PortalTarget,
  RowTarget,
  SuggestionTarget,
} from '@/types/portal'

export interface Indexed<T> {
  /** Position in the full match list, which is what the digit shortcuts count */
  readonly index: number
  readonly item: T
}

export interface PartitionedTargets {
  readonly commands: ReadonlyArray<Indexed<CommandTarget>>
  readonly suggestions: ReadonlyArray<Indexed<SuggestionTarget>>
  readonly cards: ReadonlyArray<Indexed<CardTarget>>
  readonly rows: ReadonlyArray<Indexed<RowTarget>>
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
 * Splits the launcher's matches into the sections that render them, carrying each entry's
 * position in the combined list so the digit shortcuts stay continuous across all of them.
 * @param {ReadonlyArray<PortalTarget>} matches - Current launcher matches, in order
 * @returns {PartitionedTargets} - Matches grouped by section, each tagged with its index
 */
export function partitionTargets(matches: ReadonlyArray<PortalTarget>): PartitionedTargets {
  const commands: Indexed<CommandTarget>[] = []
  const suggestions: Indexed<SuggestionTarget>[] = []
  const cards: Indexed<CardTarget>[] = []
  const rows: Indexed<RowTarget>[] = []

  matches.forEach((item, index) => {
    if (isCommand(item)) {
      commands.push({ index, item })
    } else if (isSuggestion(item)) {
      suggestions.push({ index, item })
    } else if (isRow(item)) {
      rows.push({ index, item })
    } else {
      cards.push({ index, item })
    }
  })

  return { commands, suggestions, cards, rows }
}
