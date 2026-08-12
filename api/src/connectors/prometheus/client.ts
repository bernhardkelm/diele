/**
 * A query the instance ran and refused. It answered, so this says nothing about its health, and
 * only a fault that is not one of these means the connector itself stopped working.
 */
export class QueryRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryRejectedError'
  }
}

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

/** One alert the instance's own rule evaluation currently holds, as the v1 API shapes it. */
export interface AlertRecord {
  readonly labels?: Record<string, string>
  readonly annotations?: Record<string, string>
  readonly state?: string
  /** ISO timestamp of when it started firing */
  readonly activeAt?: string
}

/** One alert an Alertmanager holds, as its v2 API shapes it. */
export interface ManagedAlertRecord {
  readonly labels?: Record<string, string>
  readonly annotations?: Record<string, string>
  /** `active`, `suppressed` while silenced or inhibited, or `unprocessed` */
  readonly status?: { readonly state?: string }
  /** ISO timestamp of when it started firing */
  readonly startsAt?: string
  /** Where the rule that raised it can be seen, which the source builds against its own origin */
  readonly generatorURL?: string
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
 * Refuses a response the instance would not serve without credentials.
 *
 * Told apart, because the token being optional makes a refusal ambiguous: one of these is a
 * wrong token and the other is an instance that wants one at all.
 * @param {Response} response - Response as it came back
 * @param {string | undefined} token - Bearer token the request carried, when it carried one
 * @returns {void}
 */
function refuseUnauthorized(response: Response, token: string | undefined): void {
  if (response.status !== 401 && response.status !== 403) {
    return
  }

  throw new Error(
    token
      ? `the token was rejected (${response.status})`
      : `this instance wants a bearer token (${response.status})`,
  )
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

  refuseUnauthorized(response, token)

  // 400 and 422 carry Prometheus' own explanation of what is wrong with the query, which is
  // worth more than the status. Anything else is read as the status alone.
  const payload = (await response.json().catch(() => undefined)) as
    | { status?: string; data?: InstantResult; error?: string }
    | undefined

  if (payload?.status === 'success' && payload.data) {
    return payload.data
  }

  // Its own explanation carries the status too: a rejected query and an instance that is unwell
  // both arrive here, and only the status says which.
  if (payload?.error) {
    const message = `${payload.error} (${response.status})`

    if (response.status === 400 || response.status === 422) {
      throw new QueryRejectedError(message)
    }

    throw new Error(message)
  }

  throw new Error(`Prometheus answered ${response.status}`)
}

/**
 * Reads the alerts the instance's own rule evaluation currently holds.
 *
 * Its own rules only, which is the whole of what a Prometheus knows: an Alertmanager in front of
 * it is what dedupes across a pair and honours silences, and this endpoint has never heard of
 * either. A portal that also runs one is the case for reading that instead, which this does not.
 * @param {string} baseUrl - Prometheus origin with trailing slashes already stripped
 * @param {string | undefined} token - Bearer token, when the instance wants one
 * @param {AbortSignal} signal - Aborts the request when the caller runs out of time
 * @returns {Promise<ReadonlyArray<AlertRecord>>} - Every alert it holds, whatever state it is in
 */
export async function listAlerts(
  baseUrl: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ReadonlyArray<AlertRecord>> {
  const response = await fetch(`${baseUrl}/api/v1/alerts`, { headers: headersFor(token), signal })

  refuseUnauthorized(response, token)

  const payload = (await response.json().catch(() => undefined)) as
    | { status?: string; data?: { alerts?: ReadonlyArray<AlertRecord> }; error?: string }
    | undefined

  if (payload?.status === 'success') {
    // An instance with no rules loaded answers `success` with no alerts key at all, which is
    // nothing firing rather than a malformed response.
    return payload.data?.alerts ?? []
  }

  throw new Error(
    payload?.error
      ? `${payload.error} (${response.status})`
      : `Prometheus answered ${response.status}`,
  )
}

/**
 * Reads what an Alertmanager currently holds.
 *
 * Asked for the active ones alone, so what it has been told to keep quiet stays quiet: a silence
 * is somebody saying they already know, and a portal that went on reporting it anyway would teach
 * everyone to read past the line. Inhibited alerts go the same way, being the ones a worse alert
 * already covers.
 *
 * This is also the only road by which an alert nobody wrote a rule for arrives, since an
 * Alertmanager holds whatever was sent to it rather than only what one Prometheus evaluates.
 * @param {string} baseUrl - Alertmanager origin with trailing slashes already stripped
 * @param {string | undefined} token - Bearer token, when it sits behind the same auth as the instance
 * @param {AbortSignal} signal - Aborts the request when the caller runs out of time
 * @returns {Promise<ReadonlyArray<ManagedAlertRecord>>} - The alerts it is holding
 */
export async function listManagedAlerts(
  baseUrl: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ReadonlyArray<ManagedAlertRecord>> {
  const url = new URL(`${baseUrl}/api/v2/alerts`)
  url.searchParams.set('active', 'true')
  url.searchParams.set('silenced', 'false')
  url.searchParams.set('inhibited', 'false')
  url.searchParams.set('unprocessed', 'false')

  const response = await fetch(url, { headers: headersFor(token), signal })

  refuseUnauthorized(response, token)

  // A bare array rather than the `{status, data}` envelope the Prometheus API uses, so anything
  // else is this not being an Alertmanager at all, which is worth saying in those words.
  const payload = (await response.json().catch(() => undefined)) as unknown

  if (!response.ok) {
    throw new Error(`the Alertmanager answered ${response.status}`)
  }

  if (!Array.isArray(payload)) {
    throw new Error('that url answered, but not like an Alertmanager')
  }

  return payload as ReadonlyArray<ManagedAlertRecord>
}
