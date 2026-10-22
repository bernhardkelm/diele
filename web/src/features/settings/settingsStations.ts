import type { ListAction } from '@/helpers/listActions'
import type {
  SettingsField,
  SettingsItem,
  SettingsOption,
  SettingsPagedItems,
  SettingsSection,
} from '@/features/settings/settingsSections'

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

interface FieldStation {
  readonly kind: 'field'
  readonly key: string
  readonly label: string
  readonly section: SettingsSection
  readonly field: SettingsField
}

export interface ItemStation {
  readonly kind: 'item'
  readonly key: string
  readonly label: string
  readonly section: SettingsSection
  readonly item: SettingsItem
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
  /** Whether running it lists more rows where it stands, so the caret moves onto the first of them */
  readonly reveals?: boolean
}

/**
 * One stop in the settings view's keyboard ring. A section's options are stations in the same
 * list as the section itself, which is what lets one pair of arrow keys reach everything.
 */
export type SettingsStation =
  | SectionStation
  | OptionStation
  | FieldStation
  | ItemStation
  | ActionStation

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
 * Builds the station one of a section's later rows occupies.
 * @param {SettingsSection} section - Section the row belongs to
 * @param {SettingsField | SettingsItem | ListAction} row - Row being addressed
 * @returns {SettingsStation} - Its station, keyed by its kind so two kinds may share an id
 */
function rowStation(
  section: SettingsSection,
  row: SettingsField | SettingsItem | ListAction,
): SettingsStation {
  const key = `${row.kind}:${section.id}:${row.id}`

  if (row.kind === 'field') {
    return { kind: 'field', key, label: row.label, section, field: row }
  }

  if (row.kind === 'item') {
    return { kind: 'item', key, label: row.label, section, item: row }
  }

  return { kind: 'action', key, label: row.label, action: row, nested: true, section }
}

/**
 * Builds the stations a run of paged items occupies: the listed ones, then the row listing the
 * next page while any are left.
 * @param {SettingsSection} section - Section the items belong to
 * @param {SettingsPagedItems} paged - Items and how many of them are listed
 * @returns {ReadonlyArray<SettingsStation>} - Their stations, in order
 */
function pagedStations(
  section: SettingsSection,
  paged: SettingsPagedItems,
): ReadonlyArray<SettingsStation> {
  const listed = paged.items.slice(0, paged.shown).map((item) => rowStation(section, item))
  const hidden = paged.items.length - listed.length

  if (hidden <= 0) {
    return listed
  }

  const more = paged.more(hidden)

  return [
    ...listed,
    {
      kind: 'action',
      key: `action:${section.id}:${more.id}`,
      label: more.label,
      action: more,
      nested: true,
      section,
      reveals: true,
    },
  ]
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

    for (const row of section.rows ?? []) {
      if (row.kind === 'paged') {
        stations.push(...pagedStations(section, row))
      } else {
        stations.push(rowStation(section, row))
      }
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
