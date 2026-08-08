import { scoreFields } from '@/helpers/scoreFields'
import type { SearchField } from '@/helpers/searchFields'
import { tokenize } from '@/helpers/searchTokens'

/**
 * A row in a station list that does something rather than opening something. Shares the list
 * and the keyboard ring with the rows around it, so leaving a view is a row like any other and
 * not only a key nobody is told about.
 */
export interface ListAction {
  readonly kind: 'action'
  readonly id: string
  readonly label: string
  /** One line under the name, saying what running it does */
  readonly description: string
  /** Shown at the end of the row, where a section shows its counts */
  readonly trail?: string
  readonly disabled?: boolean
  readonly run: () => void
}

/**
 * Returns the texts an action is searched over. Evenly weighted, because the score is only
 * ever read as a yes or no: the actions keep their declared order rather than being ranked.
 * @param {ListAction} action - Action to describe
 * @returns {ReadonlyArray<SearchField>} - Unweighted fields
 */
function fieldsOf(action: ListAction): ReadonlyArray<SearchField> {
  return [
    { text: action.label, weight: 1 },
    { text: action.id, weight: 1 },
    { text: action.description, weight: 1 },
  ]
}

/**
 * Filters the actions a term addresses. Their order is fixed rather than ranked: they close
 * the list, so a search must not float one of them above the rows it narrowed to.
 * @param {ReadonlyArray<ListAction>} actions - Every action the list offers
 * @param {string} query - Raw search term as typed
 * @returns {ReadonlyArray<ListAction>} - Matching actions, in their declared order
 */
export function searchActions(
  actions: ReadonlyArray<ListAction>,
  query: string,
): ReadonlyArray<ListAction> {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return actions
  }

  return actions.filter((action) => scoreFields(fieldsOf(action), tokens) !== undefined)
}
