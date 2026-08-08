/**
 * Everything `GET /api/entries` serves: the rows connectors produced, how each source last
 * fared, and what to leave out.
 */

/** Render shapes an entry can arrive as. The client implements each one already. */
export type EntryKind = 'card' | 'row' | 'suggestion'

export interface EntryAction {
  /** Short word shown in the row, e.g. `ci`; empty on the default action, which is the row */
  readonly label: string
  /** What it opens, used for the title and the screen reader label */
  readonly title: string
  readonly href: string
}

export interface ApiEntry {
  /** Stable identity: the render key, the health map and the launch history all use it */
  readonly ref: string
  readonly connectorId: number
  readonly connectorType: string
  readonly kind: EntryKind
  readonly label: string
  readonly detail: string | null
  readonly url: string
  readonly keywords: ReadonlyArray<string>
  readonly actions: ReadonlyArray<EntryAction>
  /** ISO timestamp, rendered as relative time when present */
  readonly timestamp: string | null
  readonly parentRef: string | null
  /** Offered only while a term is being searched, never on the resting page */
  readonly searchOnly: boolean
}

export interface ApiEntriesSource {
  readonly connectorId: number
  readonly type: string
  readonly label: string
  /** Short tag rows carry when several kinds of source mix in one list, e.g. `gl` */
  readonly mark: string
  readonly syncedAt: string | null
  /** Set when the last run failed, so the page can say the list is old rather than short */
  readonly error: string | null
}

export interface ApiHidden {
  /** Hidden for everyone, by an admin */
  readonly all: ReadonlyArray<string>
  /** Hidden by whoever is asking, for themselves */
  readonly mine: ReadonlyArray<string>
}

export interface ApiEntries {
  readonly entries: ReadonlyArray<ApiEntry>
  readonly sources: ReadonlyArray<ApiEntriesSource>
  /** Refs to leave out of the list, in the two scopes they can be hidden in */
  readonly hidden: ApiHidden
}
