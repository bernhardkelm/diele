/**
 * What the history endpoints serve and accept: pages the person visited, kept per account and
 * offered in the search the way an address bar offers them.
 *
 * Off at every level until someone turns it on. The instance switch decides whether the feature
 * exists, the source switches decide what it accepts, and the account's own opt-in decides
 * whether anything is kept for that person at all.
 */

/** Where a visit was seen: opened from diele's own bar, or loaded in a browser with the extension */
export type HistorySource = 'diele' | 'extension'

export interface ApiHistoryEntry {
  readonly id: number
  /** Origin and path only, never a query or fragment */
  readonly url: string
  /** The page's own title when a source reported one */
  readonly title?: string
  readonly visits: number
  /** ISO 8601 */
  readonly lastVisitedAt: string
}

export interface ApiHistoryState {
  /** Whether the instance offers history at all, the admin's switch */
  readonly available: boolean
  /** Which sources the instance accepts visits from, each the admin's switch beneath it */
  readonly sources: Readonly<Record<HistorySource, boolean>>
  /** Whether this account has opted in */
  readonly enabled: boolean
  /** Domains never recorded for this account; each also covers its subdomains */
  readonly excludedDomains: ReadonlyArray<string>
}

/** What `GET /api/history` serves the portal's search */
export interface ApiHistory {
  readonly state: ApiHistoryState
  /**
   * The most frecent entries, capped by the server and already deduplicated against the cards,
   * saved sites and connector rows; empty unless the feature is available and the account opted in
   */
  readonly entries: ReadonlyArray<ApiHistoryEntry>
}

/** One visit as a source reports it, before the server normalises and filters it */
export interface ApiHistoryVisit {
  /** Full url as seen; the server strips it to origin and path */
  readonly url: string
  readonly title?: string
  /** ISO 8601, when the visit happened; the server's clock when absent */
  readonly at?: string
}

/** Body of `POST /api/history/visits` */
export interface ApiHistoryVisits {
  readonly source: HistorySource
  readonly visits: ReadonlyArray<ApiHistoryVisit>
}

/** Body of `PUT /api/history/preferences`; a field left out is left as it is */
export interface ApiHistoryPreferences {
  readonly enabled?: boolean
  readonly excludedDomains?: ReadonlyArray<string>
}
