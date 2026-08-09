/**
 * What `GET /api/health` serves: how each bound entry last answered, keyed by the same ref the
 * entry itself carries.
 *
 * Separate from `/api/entries` for the reason entries is separate from config: a reading changes
 * on every refresh, and folding it in would bust that payload's etag and resend the entries with
 * it.
 */

/** The states a dot can be drawn in. Kuma's four; a source reporting fewer uses fewer. */
export type HealthState = 'up' | 'down' | 'pending' | 'maintenance'

export interface ApiHealthReading {
  readonly state: HealthState
  /** Share of the last 24h the target was up, 0-1; absent when the source reports none */
  readonly uptime?: number
  /**
   * The source's own name for what it measured, shown in the dot's title. Served to an admin
   * only: a monitor name or a label set says which internal hosts exist and how they answer.
   */
  readonly detail?: string
}

export interface ApiHealth {
  /** Keyed by entry ref; an entry that is unbound or whose source could not be reached is absent */
  readonly readings: Record<string, ApiHealthReading>
  /** Seconds until the client should ask again */
  readonly pollSeconds: number
}
