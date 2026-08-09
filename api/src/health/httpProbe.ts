import type { ApiFieldSpec } from '@diele/common'
import type { HealthReading, HealthRequest } from '#connectors/types.js'
import { messageOf } from '#connectors/redact.js'
import { mapLimit } from './pool.js'

/** Long enough for a service that is thinking, short enough to answer a page load. */
const PROBE_TIMEOUT_MS = 5_000

/** One homelab box should not take thirty simultaneous sockets from one portal. */
const CONCURRENCY = 8

/** What the built-in probe refreshes at, matching the cadence the client polls on. */
export const HTTP_TTL_SECONDS = 60

/**
 * The per-entry field the built-in probe needs. Declared beside the probe for the same reason a
 * connector declares its own: what identifies a target belongs to whatever resolves it.
 */
export const HTTP_SELECTOR_FIELD: ApiFieldSpec = {
  key: 'healthPath',
  label: 'Path or URL',
  input: 'text',
  placeholder: '/healthz',
  hint: 'a path under the entry’s url, or a whole http(s) url to probe somewhere else, such as an address only this server can reach. Blank probes the entry’s url itself; 2xx is up, anything else down',
}

/**
 * Resolves the url to probe.
 *
 * A path is resolved against the entry's own url, so a card and a health endpoint under it need
 * the host written once. A whole url replaces it instead, which is what a service reachable from
 * this server under a different address than the one on the card needs - an in-cluster name, or a
 * port the public url does not expose.
 * @param {HealthRequest} request - Entry to probe and what it was bound with
 * @returns {URL} - Absolute url to request
 */
function targetOf(request: HealthRequest): URL {
  // Relative or absolute is the URL constructor's own question, and it answers it the way this
  // needs: an absolute selector ignores the base, a relative one resolves against it.
  const target = request.selector ? new URL(request.selector, request.url) : new URL(request.url)

  // The base is always http(s), but an absolute selector is free text and could name any scheme.
  // fetch would refuse most of them with a message about the runtime rather than about the
  // binding, and `file:` is not something a portal should be talked into opening.
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`${target.protocol} is not a scheme this can probe`)
  }

  return target
}

/**
 * Probes one entry. Anything that is not a 2xx is down, redirects included: a 302 to a login
 * page is the single most common way for a service to look alive while answering nothing, and
 * the whole point of probing from here rather than the browser is that the status is readable.
 * @param {HealthRequest} request - Entry to probe
 * @returns {Promise<HealthReading>} - How it answered
 */
async function probe(request: HealthRequest): Promise<HealthReading> {
  let target: URL

  try {
    target = targetOf(request)
  } catch (cause) {
    return { state: 'down', detail: messageOf(cause) }
  }

  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })

    // Nothing here reads the body, and leaving it undrained holds the socket open until the
    // agent times it out.
    await response.body?.cancel()

    const ok = response.status >= 200 && response.status < 300

    return {
      state: ok ? 'up' : 'down',
      detail: `${target.host}${target.pathname} answered ${response.status}`,
    }
  } catch (cause) {
    return { state: 'down', detail: messageOf(cause) }
  }
}

/**
 * Probes every entry bound to the built-in prober.
 * @param {ReadonlyArray<HealthRequest>} requests - Entries to probe
 * @returns {Promise<ReadonlyMap<string, HealthReading>>} - Reading per entry ref
 */
export async function probeAll(
  requests: ReadonlyArray<HealthRequest>,
): Promise<ReadonlyMap<string, HealthReading>> {
  const readings = await mapLimit(requests, CONCURRENCY, (request) => probe(request))
  const byRef = new Map<string, HealthReading>()

  requests.forEach((request, index) => {
    const reading = readings[index]
    if (reading) {
      byRef.set(request.ref, reading)
    }
  })

  return byRef
}
