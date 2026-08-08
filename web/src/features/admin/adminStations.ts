import type { ListAction } from '@/helpers/listActions'
import { summaryOf } from '@/features/admin/adminRowText'
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

interface ActionStation {
  readonly kind: 'action'
  readonly key: string
  readonly label: string
  readonly action: ListAction
}

/**
 * One stop in the admin view's keyboard ring. A feature's entries are stations in the same list
 * as the feature itself, which is what lets one pair of arrow keys reach everything.
 */
export type AdminStation = FeatureStation | EntryStation | AddStation | ActionStation

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
function entryKey(featureId: string, rowId: number): string {
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
 * Flattens the features, the expanded one's rows and the closing actions into a single ordered
 * ring. The expanded feature's rows follow it directly, so walking down from a feature steps
 * into its entries rather than over them.
 * @param {ReadonlyArray<ApiFeature>} features - Features left after filtering
 * @param {string | undefined} expanded - Feature whose rows are on screen
 * @param {ReadonlyArray<ApiRow>} rows - Rows of the expanded feature
 * @param {ReadonlyArray<ListAction>} actions - Closing actions, after every feature
 * @returns {ReadonlyArray<AdminStation>} - The ring, in the order it is rendered
 */
export function buildStations(
  features: ReadonlyArray<ApiFeature>,
  expanded: string | undefined,
  rows: ReadonlyArray<ApiRow>,
  actions: ReadonlyArray<ListAction>,
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
    })
  }

  for (const action of actions) {
    stations.push({
      kind: 'action',
      key: `action:${action.id}`,
      label: action.label,
      action,
    })
  }

  return stations
}
