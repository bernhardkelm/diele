import type { HiddenScope } from '@/composables/useHiddenEntries'
import type { ListAction } from '@/helpers/listActions'
import type { SettingsSection } from '@/features/settings/settingsSections'
import type { RowTarget } from '@/types/portal'

export interface EntryVisibility {
  /** Returns whether an entry is hidden in the scope this section owns */
  isHiddenIn: (ref: string, scope: HiddenScope) => boolean
  /** Hides an entry, or brings it back, in one scope */
  toggle: (ref: string, scope: HiddenScope) => Promise<void>
  /** Brings back everything hidden in one scope */
  showAll: (scope: HiddenScope) => Promise<void>
}

/** How each scope names itself, so the two sections are told apart at a glance. */
const TEXTS: Readonly<Record<HiddenScope, { id: string; label: string; description: string }>> = {
  mine: {
    id: 'hidden',
    label: 'Hidden entries',
    description: 'pick the repos to keep out of your own list, one switch each',
  },
  all: {
    id: 'hidden-all',
    label: 'Hidden for everyone',
    description: 'pick the repos nobody sees, one switch each',
  },
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
 * Builds a section holding one switch per connector row, deciding whether the list carries it.
 * Keyed by ref, so the choice survives a repo being renamed or moved between groups.
 *
 * The same shape serves both scopes rather than a second kind of row: hiding something for
 * yourself and hiding it for everyone are the same act at different reach, and giving them one
 * grammar is what keeps the second from needing a list of its own.
 *
 * The restore row is only there while something is hidden: on a list nothing has been taken out
 * of, it would be a row that does nothing.
 * @param {ReadonlyArray<RowTarget>} rows - Every known row, hidden ones included
 * @param {HiddenScope} scope - Whose list this section decides
 * @param {EntryVisibility} visibility - Current hidden sets and their controls
 * @returns {SettingsSection} - The section for that scope
 */
export function entrySection(
  rows: ReadonlyArray<RowTarget>,
  scope: HiddenScope,
  visibility: EntryVisibility,
): SettingsSection {
  const texts = TEXTS[scope]

  const options = rows.map((row) => {
    const hidden = visibility.isHiddenIn(row.ref, scope)
    const label = row.detail ? `${row.detail}/${row.name}` : row.name

    return {
      id: row.ref,
      label,
      detail: hidden ? 'kept out of the list' : 'shown in the list',
      on: !hidden,
      run: () => void visibility.toggle(row.ref, scope),
    }
  })

  const hiddenCount = options.filter((option) => !option.on).length

  return {
    id: texts.id,
    label: texts.label,
    description: texts.description,
    keywords: ['repo', 'repos', 'hide', 'show', 'hidden', 'gitlab', 'github', 'entries'],
    trail: `${options.length - hiddenCount}/${options.length}`,
    options,
    ...(hiddenCount > 0
      ? { action: showAllAction(hiddenCount, () => void visibility.showAll(scope)) }
      : {}),
  }
}
