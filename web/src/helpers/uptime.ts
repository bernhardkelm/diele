import type { CardTarget } from '@/types/portal'

export type ServiceState = 'up' | 'down' | 'pending' | 'maintenance'

export interface ServiceStatus {
  state: ServiceState
  /** Share of the last 24h the monitor was up, 0-1; absent when Kuma reports none */
  uptime?: number
}

// Kuma heartbeat status codes; anything else is treated as unknown and drops the card's dot.
const STATES: Record<number, ServiceState> = {
  0: 'down',
  1: 'up',
  2: 'pending',
  3: 'maintenance',
}

// Kuma keys its uptime map as `<monitorId>_<hours>`.
const UPTIME_WINDOW = '24'

interface KumaMonitor {
  id?: number
  name?: string
  url?: string
}

export interface KumaSummary {
  publicGroupList?: Array<{ monitorList?: KumaMonitor[] }>
}

export interface KumaHeartbeats {
  heartbeatList?: Record<string, Array<{ status?: number }> | undefined>
  uptimeList?: Record<string, number>
}

/**
 * Returns the hostname of an absolute url.
 * @param {string | undefined} url - Absolute url to parse
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
 * Flattens Kuma's grouped monitor list into lookups by hostname and by monitor name.
 * Kuma only reports a monitor url when the status page has "Show URL" enabled, so the
 * name lookup is what keeps matching working without it.
 * @param {KumaSummary} summary - Payload of the status page endpoint
 * @returns {{ byHost: Map<string, number>; byName: Map<string, number> }} - Monitor id lookups
 */
function indexMonitors(summary: KumaSummary): {
  byHost: Map<string, number>
  byName: Map<string, number>
} {
  const byHost = new Map<string, number>()
  const byName = new Map<string, number>()

  for (const group of summary.publicGroupList ?? []) {
    for (const monitor of group.monitorList ?? []) {
      if (monitor.id === undefined) {
        continue
      }

      const host = hostnameOf(monitor.url)
      if (host && !byHost.has(host)) {
        byHost.set(host, monitor.id)
      }

      const name = monitor.name?.trim().toLowerCase()
      if (name && !byName.has(name)) {
        byName.set(name, monitor.id)
      }
    }
  }

  return { byHost, byName }
}

/**
 * Resolves the Kuma monitor belonging to a card: the card's hostname matched against monitor
 * urls and monitor names, then its display name.
 * @param {CardTarget} service - Card to resolve
 * @param {{ byHost: Map<string, number>; byName: Map<string, number> }} lookups - Monitor id lookups
 * @returns {number | undefined} - Monitor id, or undefined when the card is unmonitored
 */
function monitorIdFor(
  service: CardTarget,
  lookups: { byHost: Map<string, number>; byName: Map<string, number> },
): number | undefined {
  const host = hostnameOf(service.url)
  if (host !== undefined) {
    // naming a monitor after its hostname is the usual Kuma habit, and the only match left
    // once the status page hides monitor urls
    const byUrlOrName = lookups.byHost.get(host) ?? lookups.byName.get(host)
    if (byUrlOrName !== undefined) {
      return byUrlOrName
    }
  }

  return lookups.byName.get(service.name.toLowerCase())
}

/**
 * Builds the status shown on each card, keyed by ref. Cards without a monitor, and monitors
 * without a heartbeat, are left out so the card renders no dot at all.
 * @param {ReadonlyArray<CardTarget>} services - Cards to resolve
 * @param {KumaSummary} summary - Payload of the status page endpoint
 * @param {KumaHeartbeats} heartbeats - Payload of the status page heartbeat endpoint
 * @returns {Map<string, ServiceStatus>} - Status per card ref
 */
export function mapServiceStatus(
  services: ReadonlyArray<CardTarget>,
  summary: KumaSummary,
  heartbeats: KumaHeartbeats,
): Map<string, ServiceStatus> {
  const lookups = indexMonitors(summary)
  const statuses = new Map<string, ServiceStatus>()

  for (const service of services) {
    const id = monitorIdFor(service, lookups)
    if (id === undefined) {
      continue
    }

    const beats = heartbeats.heartbeatList?.[String(id)]
    const last = beats?.at(-1)
    if (last?.status === undefined) {
      continue
    }

    const state = STATES[last.status]
    if (!state) {
      continue
    }

    statuses.set(service.ref, {
      state,
      uptime: heartbeats.uptimeList?.[`${id}_${UPTIME_WINDOW}`],
    })
  }

  return statuses
}
