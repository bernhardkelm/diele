import type { ListAction } from '@/helpers/listActions'
import type { SettingsSection } from '@/features/settings/settingsSections'
import type { RowTarget } from '@/types/portal'

export interface EntryVisibility {
  /** Returns whether an entry is kept out of this account's own list */
  isHiddenIn: (ref: string) => boolean
  /** Returns whether the portal keeps an entry out of every account's list */
  isHiddenForEveryone: (ref: string) => boolean
  /** Hides an entry from this account's own list, or brings it back */
  toggle: (ref: string) => Promise<void>
  /** Brings back everything this account hid */
  showAll: () => Promise<void>
}

/**
 * Builds the row that brings everything hidden in one scope back at once.
 * @param {number} count - How many entries are hidden right now
 * @param {() => void} showAll - Brings them all back
 * @returns {ListAction} - The restore row
 */
function showAllAction(count: number, showAll: () => void): ListAction {
  return {
    kind: 'action',
    id: 'show-all',
    label: 'Show all hidden entries',
    description: `brings back the ${count} entr${count === 1 ? 'y' : 'ies'} hidden here`,
    run: showAll,
  }
}

/**
 * Builds the section holding one switch per connector row, deciding whether this account's own
 * list carries it. Keyed by ref, so the choice survives a repo being renamed or moved between
 * groups.
 *
 * Only this account's own list. Keeping an entry from everyone is an administrative act, so it
 * is made in the admin panel under the connector that produced the entry, and nothing here can
 * reach it: a switch in a personal settings page that changed what every other account sees
 * would be the one row on it that is not about the person pressing it.
 *
 * A row the portal hides from everyone carries no switch here either. It is out of the list
 * whatever this account decides, so a personal switch beside it would be a second control over
 * the same row that changes nothing anyone can see.
 *
 * The restore row is only there while something is hidden: on a list nothing has been taken out
 * of, it would be a row that does nothing.
 * @param {ReadonlyArray<RowTarget>} rows - Every known row, hidden ones included
 * @param {EntryVisibility} visibility - What this account hides, and the controls that change it
 * @returns {SettingsSection} - The section
 */
export function entrySection(
  rows: ReadonlyArray<RowTarget>,
  visibility: EntryVisibility,
): SettingsSection {
  const options = rows
    .filter((row) => !visibility.isHiddenForEveryone(row.ref))
    .map((row) => {
      const hidden = visibility.isHiddenIn(row.ref)
      const label = row.detail ? `${row.detail}/${row.name}` : row.name

      return {
        id: row.ref,
        label,
        detail: hidden ? 'kept out of the list' : 'shown in the list',
        on: !hidden,
        run: () => void visibility.toggle(row.ref),
      }
    })

  const hiddenCount = options.filter((option) => !option.on).length

  return {
    id: 'hidden',
    label: 'Hidden entries',
    description: 'pick the repos to keep out of your own list, one switch each',
    keywords: ['repo', 'repos', 'hide', 'show', 'hidden', 'gitlab', 'github', 'entries'],
    trail: `${options.length - hiddenCount}/${options.length}`,
    options,
    ...(hiddenCount > 0
      ? { action: showAllAction(hiddenCount, () => void visibility.showAll()) }
      : {}),
  }
}
