// How the portal handles a failure depends on who asked for the thing that failed. Four classes,
// and every failing path in the app is one of them:
//
//   1. Someone asked for it and it failed. Throw a typed error, catch it at the boundary into an
//      `error` ref the view renders. The message comes from here. See useAdmin's AdminError,
//      which also carries the status so a lapsed session and a refusal read differently.
//   2. A background refresh failed. Keep whatever is already on screen, console.warn once, and
//      never surface it: last visit's data beats an error where the user asked for neither.
//      See usePortalConfig, useConnectorEntries, useServiceStatus.
//   3. Best-effort storage failed. Swallow it, no log. True by construction now that helpers/
//      storage.ts is the only thing that touches localStorage.
//   4. A reachability probe failed. Swallow it, no log: the failure is the answer being asked
//      for. See useLocalhostStatus.
//
// Only class 1 reaches this file, because it is the only one whose message a person ever reads.

/** The shape portal-api answers a failure with, alongside whatever the route itself returns. */
export interface ApiErrorPayload {
  /** One line summarising the failure */
  readonly error?: string
  /** Per-field validation failures, the first of which is the one worth showing */
  readonly details?: ReadonlyArray<{
    readonly path?: ReadonlyArray<unknown>
    readonly message?: string
  }>
}

/**
 * Reads a response body as json, tolerating one that is not. A failure answered with html or
 * with nothing at all still has to produce something a caller can read a message out of.
 * @param {Response} response - Response to read
 * @returns {Promise<ApiErrorPayload & Record<string, unknown>>} - Parsed body, empty when it was not json
 */
export async function readPayload(
  response: Response,
): Promise<ApiErrorPayload & Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => ({}))

  return (typeof payload === 'object' && payload !== null ? payload : {}) as ApiErrorPayload &
    Record<string, unknown>
}

/**
 * Reads the message out of a failed payload. The first detail wins over the summary, because a
 * validation failure names what actually went wrong where the summary only says that something
 * did.
 * @param {ApiErrorPayload} payload - Parsed body of the failed response
 * @param {string} fallback - Message for a failure that carried none
 * @returns {string} - Message to show
 */
export function apiMessage(payload: ApiErrorPayload, fallback: string): string {
  return payload.details?.[0]?.message ?? payload.error ?? fallback
}

/**
 * Reads the message the way a form wants it, prefixed with the field that failed. Only useful
 * where several fields were submitted at once and the message alone would not say which.
 * @param {ApiErrorPayload} payload - Parsed body of the failed response
 * @param {string} fallback - Message for a failure that carried none
 * @returns {string} - Message to show, prefixed with the field path when there is one
 */
export function apiFieldMessage(payload: ApiErrorPayload, fallback: string): string {
  const detail = payload.details?.[0]
  if (!detail?.message) {
    return payload.error ?? fallback
  }

  const field = Array.isArray(detail.path) ? detail.path.join('.') : ''

  return field ? `${field}: ${detail.message}` : detail.message
}
