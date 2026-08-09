/** `[unixSeconds, "value"]`. The value is a string, including for `NaN` and `+Inf`. */
export type InstantPair = [number, string]

/** One sample of a vector result, as the v1 API shapes it. */
export interface InstantSample {
  readonly metric?: Record<string, string>
  readonly value?: InstantPair
}

export interface InstantResult {
  readonly resultType?: string
  /** A vector's samples, or a scalar's own pair, which the v1 API does not wrap in a sample */
  readonly result?: ReadonlyArray<InstantSample> | InstantPair
}

/**
 * Builds the headers a request carries. The token is optional: a homelab Prometheus behind a
 * private network commonly has no auth at all, and requiring one would mean requiring
 * DIELE_SECRET_KEYS to store something nobody needs.
 * @param {string | undefined} token - Bearer token, when the instance wants one
 * @returns {Record<string, string>} - Headers for fetch
 */
function headersFor(token: string | undefined): Record<string, string> {
  return {
    accept: 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

/**
 * Runs one instant query.
 *
 * A query Prometheus itself rejects throws with its own message: a typo in PromQL is the most
 * likely thing to be wrong here, and its parser says where.
 * @param {string} baseUrl - Prometheus origin with trailing slashes already stripped
 * @param {string} query - PromQL expression
 * @param {string | undefined} token - Bearer token, when the instance wants one
 * @param {AbortSignal} signal - Aborts the request when the caller runs out of time
 * @returns {Promise<InstantResult>} - The `data` object of a successful response
 */
export async function instantQuery(
  baseUrl: string,
  query: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<InstantResult> {
  const url = new URL(`${baseUrl}/api/v1/query`)
  url.searchParams.set('query', query)

  const response = await fetch(url, { headers: headersFor(token), signal })

  if (response.status === 401 || response.status === 403) {
    throw new Error('the token was rejected')
  }

  // 400 and 422 carry Prometheus' own explanation of what is wrong with the query, which is
  // worth more than the status. Anything else is read as the status alone.
  const payload = (await response.json().catch(() => undefined)) as
    | { status?: string; data?: InstantResult; error?: string }
    | undefined

  if (payload?.status === 'success' && payload.data) {
    return payload.data
  }

  if (payload?.error) {
    throw new Error(payload.error)
  }

  throw new Error(`Prometheus answered ${response.status}`)
}
