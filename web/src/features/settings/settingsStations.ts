import type { ListAction } from '@/helpers/listActions'
import type { SettingsOption, SettingsSection } from '@/features/settings/settingsSections'

interface SectionStation {
  readonly kind: 'section'
  readonly key: string
  readonly label: string
  readonly section: SettingsSection
}

interface OptionStation {
  readonly kind: 'option'
  readonly key: string
  readonly label: string
  readonly section: SettingsSection
  readonly option: SettingsOption
}

interface ActionStation {
  readonly kind: 'action'
  readonly key: string
  readonly label: string
  readonly action: ListAction
  /** Whether the row belongs to an open section rather than to the list itself */
  readonly nested: boolean
  /** Section it belongs to, so Escape from it lands on the row that opened it */
  readonly section?: SettingsSection
}

/**
 * One stop in the settings view's keyboard ring. A section's options are stations in the same
 * list as the section itself, which is what lets one pair of arrow keys reach everything.
 */
export type SettingsStation = SectionStation | OptionStation | ActionStation

/**
 * Names the station a section occupies.
 * @param {string} sectionId - Section the station belongs to
 * @returns {string} - Its key
 */
export function sectionKey(sectionId: string): string {
  return `section:${sectionId}`
}

/**
 * Names the station one of a section's options occupies.
 * @param {string} sectionId - Section the option belongs to
 * @param {string} optionId - Option being addressed
 * @returns {string} - Its key
 */
function optionKey(sectionId: string, optionId: string): string {
  return `option:${sectionId}:${optionId}`
}

/**
 * Flattens the sections, the expanded one's rows and the closing actions into a single ordered
 * ring. The expanded section's rows follow it directly, so walking down from a section steps
 * into its options rather than over them.
 * @param {ReadonlyArray<SettingsSection>} sections - Sections left after filtering
 * @param {string | undefined} expanded - Section whose rows are on screen
 * @param {ReadonlyArray<ListAction>} actions - Closing actions, after every section
 * @returns {ReadonlyArray<SettingsStation>} - The ring, in the order it is rendered
 */
export function buildSettingsStations(
  sections: ReadonlyArray<SettingsSection>,
  expanded: string | undefined,
  actions: ReadonlyArray<ListAction>,
): ReadonlyArray<SettingsStation> {
  const stations: SettingsStation[] = []

  for (const section of sections) {
    stations.push({
      kind: 'section',
      key: sectionKey(section.id),
      label: section.label,
      section,
    })

    if (section.id !== expanded) {
      continue
    }

    if (section.action) {
      stations.push({
        kind: 'action',
        key: `action:${section.id}:${section.action.id}`,
        label: section.action.label,
        action: section.action,
        nested: true,
        section,
      })
    }

    for (const option of section.options) {
      stations.push({
        kind: 'option',
        key: optionKey(section.id, option.id),
        label: option.label,
        section,
        option,
      })
    }
  }

  for (const action of actions) {
    stations.push({
      kind: 'action',
      key: `action:${action.id}`,
      label: action.label,
      action,
      nested: false,
    })
  }

  return stations
}
