import type { HealthReading, HealthRequest } from '#connectors/types.js'
import type { KumaMonitor } from './metrics.js'

export interface MonitorLookups {
  readonly byName: ReadonlyMap<string, KumaMonitor>
  readonly byHost: ReadonlyMap<string, KumaMonitor>
}

/**
 * Returns the hostname of an absolute url.
 * @param {string | undefined} url - Url to read
 * @returns {string | undefined} - Lowercased hostname, or undefined when unparseable
 */
function hostnameOf(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }

  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * Builds the lookups a request is matched through. First writer wins in both, so two monitors
 * on one host resolve to whichever Kuma listed first rather than to neither.
 * @param {ReadonlyArray<KumaMonitor>} monitors - Monitors as the metrics carried them
 * @returns {MonitorLookups} - By lowercased name and by lowercased host
 */
export function indexMonitors(monitors: ReadonlyArray<KumaMonitor>): MonitorLookups {
  const byName = new Map<string, KumaMonitor>()
  const byHost = new Map<string, KumaMonitor>()

  for (const monitor of monitors) {
    const name = monitor.name.trim().toLowerCase()
    if (name && !byName.has(name)) {
      byName.set(name, monitor)
    }

    // A tcp or ping monitor carries a hostname rather than a url, so both are indexed the same
    const host = hostnameOf(monitor.url) ?? monitor.hostname?.toLowerCase()
    if (host && !byHost.has(host)) {
      byHost.set(host, monitor)
    }
  }

  return { byName, byHost }
}

/**
 * Resolves one bound entry to a monitor, then to a reading.
 *
 * The binding's own selector first, because someone said it. Then the entry's hostname, which is
 * how a monitor tends to be named anyway, and then the entry's label. An entry that matches
 * nothing gets no reading rather than a red dot: a monitor that does not exist is not a service
 * that is down.
 * @param {HealthRequest} request - Entry to resolve
 * @param {MonitorLookups} lookups - Monitors indexed by name and by host
 * @returns {HealthReading | undefined} - The reading, or undefined when nothing matched
 */
export function readingFor(
  request: HealthRequest,
  lookups: MonitorLookups,
): HealthReading | undefined {
  const named = request.selector?.trim().toLowerCase()
  const host = hostnameOf(request.url)

  const monitor =
    (named ? lookups.byName.get(named) : undefined) ??
    (host ? (lookups.byHost.get(host) ?? lookups.byName.get(host)) : undefined) ??
    lookups.byName.get(request.label.trim().toLowerCase())

  if (!monitor) {
    return undefined
  }

  // No uptime figure: /metrics carries the current status and the response time, and none of
  // Kuma's 24h arithmetic. The dot renders without a percentage rather than with a made-up one.
  return { state: monitor.state, detail: monitor.name }
}
