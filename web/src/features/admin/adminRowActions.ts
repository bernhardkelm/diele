import type { AdminStation } from '@/features/admin/adminStations'

export type RowActionId = 'open' | 'edit' | 'up' | 'down' | 'toggle' | 'sync' | 'remove'

export interface RowAction {
  readonly id: RowActionId
  /** Trail word; empty on the row's own default action, which the row already stands for */
  readonly label: string
  /** Shown but not runnable, and stepped over by the left and right keys */
  readonly disabled?: boolean
  /** Carries the word's meaning into its colour: the off state, or something destructive */
  readonly tone?: 'off' | 'danger'
  /** Shown at rest rather than revealed, for a word that states something as well as doing it */
  readonly persistent?: boolean
}

const EDIT: RowAction = { id: 'edit', label: '' }
const OPEN: RowAction = { id: 'open', label: '' }

/**
 * Builds the switch, whose word is the state it is in rather than the one it would move to.
 *
 * An off switch stays on screen in the colour the off badge always had: it is what tells a
 * glance down the list which entries are dormant, and hiding that until the row is reached
 * would mean the list no longer says so. A feature that is only a switch keeps its word either
 * way, since the state is the whole of what the row has to report.
 * @param {boolean} enabled - Whether the thing it switches is currently on
 * @param {boolean} always - Whether the word stays on screen even while on
 * @returns {RowAction} - The switch
 */
function toggleAction(enabled: boolean, always = false): RowAction {
  return {
    id: 'toggle',
    label: enabled ? 'on' : 'off',
    tone: enabled ? undefined : 'off',
    persistent: always || !enabled,
  }
}

/**
 * Returns everything the left and right keys reach on a station, the row's own default first.
 * The default is what Enter runs while nothing else is selected, so it never appears as a word
 * in the trail: the row already is it.
 *
 * Mirrors the repo rows, where the arrows walk a row's quick links and index 0 is the repo
 * itself, so one pair of keys means the same thing in both lists.
 * @param {AdminStation | undefined} station - Station holding focus
 * @returns {ReadonlyArray<RowAction>} - Its actions, default first, empty when it has none
 */
export function rowActionsFor(station: AdminStation | undefined): ReadonlyArray<RowAction> {
  if (!station) {
    return []
  }

  if (station.kind === 'entry') {
    // A built-in row is shown but not owned by whoever is looking at it, so it offers nothing.
    if (station.row.readonly) {
      return []
    }

    // Per capability rather than per connector: anything that fetches on a schedule can be
    // asked to fetch now, which is what says whether a token someone just entered works.
    const fetches = station.feature.capabilities?.includes('entries') === true
    // The same question one row down: a bound entry can be asked again whether it is up, which
    // is what says whether the path or the query someone just typed reaches anything.
    const bound = Boolean(station.row.health)

    return [
      EDIT,
      { id: 'up', label: '▴', disabled: station.first },
      { id: 'down', label: '▾', disabled: station.last },
      // the state it is in, not the state it would go to: one word that says where the row
      // stands and flips it, rather than a badge and an action that read as each other
      toggleAction(station.row.enabled !== false),
      ...(fetches ? [{ id: 'sync' as const, label: 'sync' }] : []),
      ...(!fetches && bound ? [{ id: 'sync' as const, label: 'probe' }] : []),
      { id: 'remove', label: 'del', tone: 'danger' },
    ]
  }

  if (station.kind === 'feature') {
    if (station.feature.unavailable) {
      return []
    }

    if (!station.feature.toggleable) {
      return [OPEN]
    }

    const toggle = toggleAction(Boolean(station.feature.enabled), station.feature.switchOnly)

    // nothing to open, so the switch is the row's own action rather than one beside it
    return station.feature.switchOnly ? [toggle] : [OPEN, toggle]
  }

  if (station.kind === 'add') {
    return [EDIT]
  }

  // nothing to open, so the switch is the row's own action rather than one beside it
  if (station.kind === 'hidden') {
    return [toggleAction(!station.hidden, true)]
  }

  return station.action.disabled ? [] : [OPEN]
}
