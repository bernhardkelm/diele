/**
 * What `GET /api/health` serves: how each bound entry last answered, keyed by the same ref the
 * entry itself carries.
 *
 * Separate from `/api/entries` for the reason entries is separate from config: a reading changes
 * on every refresh, and folding it in would bust that payload's etag and resend the entries with
 * it.
 */

/**
 * The states a dot can be drawn in. Kuma's four, and one of our own.
 *
 * `unknown` is the source itself failing rather than the service it watches: a decorator that
 * cannot be reached knows nothing about what it monitors, so calling those services `down` would
 * blame the wrong thing. It is drawn rather than left off, because a dot that quietly vanishes
 * is how a decorator stops working without anyone noticing. A source whose whole job is to reach
 * the service, like the HTTP probe, never reports it: there, unreachable is what down means.
 */
export type HealthState = 'up' | 'down' | 'pending' | 'maintenance' | 'unknown'

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
  /** Keyed by entry ref; absent for an entry that is unbound, or bound to a source switched off or gone */
  readonly readings: Record<string, ApiHealthReading>
  /** Seconds until the client should ask again */
  readonly pollSeconds: number
}
