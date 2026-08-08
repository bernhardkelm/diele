import type { ListAction } from '@/helpers/listActions'
import { summaryOf } from '@/features/admin/adminRowText'
import type { RowTarget } from '@/types/portal'
import type { ApiFeature, ApiRow } from '@diele/common'

interface FeatureStation {
  readonly kind: 'feature'
  readonly key: string
  readonly label: string
  readonly feature: ApiFeature
}

interface EntryStation {
  readonly kind: 'entry'
  readonly key: string
  readonly label: string
  readonly feature: ApiFeature
  readonly row: ApiRow
  /** Whether reordering in that direction has nowhere to go */
  readonly first: boolean
  readonly last: boolean
}

interface AddStation {
  readonly kind: 'add'
  readonly key: string
  readonly label: string
  readonly feature: ApiFeature
}

interface HiddenStation {
  readonly kind: 'hidden'
  readonly key: string
  readonly label: string
  readonly feature: ApiFeature
  readonly entry: RowTarget
  /** Whether the portal keeps this entry out of everyone's list */
  readonly hidden: boolean
}

interface ActionStation {
  readonly kind: 'action'
  readonly key: string
  readonly label: string
  readonly action: ListAction
  /** Whether the row belongs to an open feature rather than closing the list */
  readonly nested: boolean
}

/**
 * One stop in the admin view's keyboard ring. A feature's entries are stations in the same list
 * as the feature itself, which is what lets one pair of arrow keys reach everything.
 */
export type AdminStation =
  | FeatureStation
  | EntryStation
  | AddStation
  | HiddenStation
  | ActionStation

/**
 * Names the station a feature occupies.
 * @param {string} featureId - Feature the station belongs to
 * @returns {string} - Its key
 */
export function featureKey(featureId: string): string {
  return `feature:${featureId}`
}

/**
 * Names the station one of a feature's rows occupies.
 * @param {string} featureId - Feature the row belongs to
 * @param {number} rowId - Row being addressed
 * @returns {string} - Its key
 */
export function entryKey(featureId: string, rowId: number): string {
  return `entry:${featureId}:${rowId}`
}

/**
 * Names the station that opens a feature's blank form.
 * @param {string} featureId - Feature to add to
 * @returns {string} - Its key
 */
function addKey(featureId: string): string {
  return `add:${featureId}`
}

/**
 * Names the station one of a connector's produced entries occupies.
 * @param {string} featureId - Connector the entry came from
 * @param {string} entryRef - Entry being addressed
 * @returns {string} - Its key
 */
function hiddenKey(featureId: string, entryRef: string): string {
  return `hidden:${featureId}:${entryRef}`
}

export interface HiddenEntries {
  /** Connector instance whose produced entries are on screen, or undefined while none is open */
  readonly openRow: number | undefined
  /** What that instance produced, in the order the switches are listed */
  readonly entries: ReadonlyArray<RowTarget>
  /** Refs the portal keeps out of everyone's list */
  readonly hidden: ReadonlyArray<string>
  /** Brings every one of them back, offered only while something is hidden */
  readonly showAll: ListAction | undefined
}

/**
 * Flattens the features, the expanded one's rows and the closing actions into a single ordered
 * ring. The expanded feature's rows follow it directly, so walking down from a feature steps
 * into its entries rather than over them.
 *
 * A connector's produced entries hang off the instance that fetched them, one level below it and
 * only while that instance is open. Under the feature instead they would read as belonging to
 * every instance at once, and reaching the second connector's repos would mean walking the whole
 * of the first one's.
 * @param {ReadonlyArray<ApiFeature>} features - Features left after filtering
 * @param {string | undefined} expanded - Feature whose rows are on screen
 * @param {ReadonlyArray<ApiRow>} rows - Rows of the expanded feature
 * @param {ReadonlyArray<ListAction>} actions - Closing actions, after every feature
 * @param {HiddenEntries | undefined} visibility - What the open instance produced, when one is open
 * @returns {ReadonlyArray<AdminStation>} - The ring, in the order it is rendered
 */
export function buildStations(
  features: ReadonlyArray<ApiFeature>,
  expanded: string | undefined,
  rows: ReadonlyArray<ApiRow>,
  actions: ReadonlyArray<ListAction>,
  visibility?: HiddenEntries,
): ReadonlyArray<AdminStation> {
  const stations: AdminStation[] = []

  for (const feature of features) {
    stations.push({
      kind: 'feature',
      key: featureKey(feature.id),
      label: feature.label,
      feature,
    })

    if (feature.id !== expanded || feature.unavailable || feature.switchOnly) {
      continue
    }

    // Ahead of the rows rather than after them: adding is what a feature is opened for as often
    // as not, and behind a long list it is a scroll away from the row that was just opened.
    stations.push({
      kind: 'add',
      key: addKey(feature.id),
      label: 'Add entry',
      feature,
    })

    rows.forEach((row, index) => {
      stations.push({
        kind: 'entry',
        key: entryKey(feature.id, row.id),
        label: summaryOf(row),
        feature,
        row,
        first: index === 0,
        last: index === rows.length - 1,
      })

      if (!visibility || row.id !== visibility.openRow) {
        return
      }

      // Ahead of the switches, the way the add row leads a feature's entries: on a list long
      // enough to need it, a restore behind them all is a scroll away from what it undoes.
      if (visibility.showAll) {
        stations.push({
          kind: 'action',
          key: `action:${feature.id}:${row.id}:${visibility.showAll.id}`,
          label: visibility.showAll.label,
          action: visibility.showAll,
          nested: true,
        })
      }

      for (const entry of visibility.entries) {
        stations.push({
          kind: 'hidden',
          key: hiddenKey(feature.id, entry.ref),
          label: entry.detail ? `${entry.detail}/${entry.name}` : entry.name,
          feature,
          entry,
          hidden: visibility.hidden.includes(entry.ref),
        })
      }
    })
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
