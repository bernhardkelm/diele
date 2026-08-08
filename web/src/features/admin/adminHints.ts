import type { RowAction, RowActionId } from '@/features/admin/adminRowActions'
import type { AdminStation } from '@/features/admin/adminStations'
import { FIELD_HINTS, LEAVE_HINT, type KeyHint } from '@/helpers/keyHints'

/**
 * Names what a station's own key is called, which is the only hint every station has.
 * @param {AdminStation} station - Station holding focus
 * @param {boolean} expanded - Whether a feature station is already open
 * @param {boolean} editable - Whether the station offers its default action at all
 * @returns {KeyHint | undefined} - The hint for Enter, or undefined when it does nothing
 */
function primaryHint(
  station: AdminStation,
  expanded: boolean,
  editable: boolean,
  switchOnly: boolean,
): KeyHint | undefined {
  if (station.kind === 'feature') {
    if (switchOnly) {
      return { text: '↵ turns it on/off', key: true }
    }

    return { text: expanded ? '↵ closes' : '↵ opens', key: true }
  }

  if (station.kind === 'add') {
    return { text: '↵ adds an entry', key: true }
  }

  if (station.kind === 'action') {
    return { text: '↵ runs', key: true }
  }

  return editable ? { text: '↵ edits', key: true } : undefined
}

/**
 * Names the keys whatever holds focus answers to.
 *
 * Built from the station's own actions rather than from its kind, because the actions differ
 * within a kind: a built-in row can neither be edited nor deleted, and a feature that is not
 * toggleable has nothing for `d` to do. Naming a key that does nothing is worse than naming
 * none, since the only way to find out is to press it.
 * @param {AdminStation | undefined} station - Station holding focus, or undefined for the field
 * @param {ReadonlyArray<RowAction>} actions - What that station offers
 * @param {boolean} expanded - Whether a feature station is already open
 * @param {boolean} switchOnly - Whether the feature owns no rows and is only a switch
 * @returns {ReadonlyArray<KeyHint>} - Hints to render under the search field
 */
export function hintsFor(
  station: AdminStation | undefined,
  actions: ReadonlyArray<RowAction>,
  expanded: boolean,
  switchOnly = false,
): ReadonlyArray<KeyHint> {
  if (!station) {
    return FIELD_HINTS
  }

  /**
   * Returns whether the station offers an action at all.
   * @param {RowActionId} id - Action to look for
   * @returns {boolean} - True when it is there
   */
  function has(id: RowActionId): boolean {
    return actions.some((action) => action.id === id)
  }

  const hints: KeyHint[] = []
  const primary = primaryHint(station, expanded, has('edit'), switchOnly)

  if (primary) {
    hints.push(primary)
  }

  if (has('toggle') && !switchOnly) {
    hints.push({ text: 'd on/off', key: true })
  }

  // only where there is somewhere to move to: a list of one, or an end of it, has neither
  if (actions.some((action) => (action.id === 'up' || action.id === 'down') && !action.disabled)) {
    hints.push({ text: 'alt+↑↓ reorders', key: true })
  }

  if (has('remove')) {
    hints.push({ text: 'x deletes', key: true })
  }

  if (actions.filter((action) => !action.disabled).length > 1) {
    hints.push({ text: '←→ picks an action', key: true })
  }

  hints.push(LEAVE_HINT)

  return hints
}
