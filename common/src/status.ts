/**
 * What `GET /status` serves. Reachable without a session, because a container's health probe
 * has no way to hold one.
 */

export interface ApiStatus {
  readonly status: 'ok'
  /** Build identity, taken from the git tag the image was built at */
  readonly version: string
}
