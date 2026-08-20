import type { SignalSeverity } from '@diele/common'
import type { Signal } from '#connectors/types.js'
import { meetsFloor } from '#signals/severity.js'

/**
 * The severity words this understands. A source labelling an alert anything else is not saying
 * how loud it is in a vocabulary the portal shares, so it is left off rather than guessed at.
 */
const SEVERITIES: Readonly<Record<string, SignalSeverity>> = {
  info: 'info',
  warning: 'warning',
  critical: 'critical',
}

/**
 * Alerts a stock install fires forever by design. `Watchdog` exists to prove the alerting path
 * itself works end to end, so on a healthy cluster it is always firing and is the one thing the
 * portal would permanently report.
 *
 * Hidden by default and not always, because that permanence cuts both ways: a line that is
 * always lit says nothing, but somebody who wants one place to see that the pipeline is alive is
 * asking a fair question of exactly this alert.
 */
const HEARTBEATS: ReadonlySet<string> = new Set(['watchdog'])

/**
 * Hashes a label set into something short and stable.
 *
 * FNV-1a over the sorted pairs. Sorted because a JSON object's key order is whatever the source
 * serialised it in, and hashed rather than joined because the id is rendered as a DOM key: a
 * label set carries the instance and the job, which is the internal topology the detail is kept
 * from a non-admin for.
 *
 * Ours rather than Alertmanager's own fingerprint, so the same condition keeps its id when the
 * Alertmanager field is filled in or cleared and the alert starts arriving by the other road.
 * @param {Record<string, string>} labels - Labels as the source sent them
 * @returns {string} - Hex digest, stable for as long as the labels are
 */
function fingerprint(labels: Record<string, string>): string {
  const text = Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(',')

  let hash = 0x811c9dc5

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    // The 32-bit FNV prime as shifts, since a plain multiply overflows into a float here
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}

/**
 * Describes an alert in the source's own words, or nothing when it gave none.
 * @param {Record<string, string>} annotations - Annotations as the source sent them
 * @param {Record<string, string>} labels - Labels as the source sent them
 * @returns {string | undefined} - Summary and instance, or undefined when neither is there
 */
function detailOf(
  annotations: Record<string, string>,
  labels: Record<string, string>,
): string | undefined {
  const summary = annotations.summary?.trim() || annotations.description?.trim()
  const instance = labels.instance?.trim()

  if (summary && instance) {
    return `${summary} (${instance})`
  }

  return summary || instance || undefined
}

export interface AlertMapping {
  /** Instance the alerts came from, which namespaces each id */
  readonly connectorId: number
  /** Origin they were read from, for a link where an alert names no better one */
  readonly baseUrl: string
  /** Least severe level this source was set to report */
  readonly floor: SignalSeverity
  /** Whether the always-firing heartbeat alert is kept off the portal */
  readonly hideWatchdog: boolean
}

export interface SignalSource {
  readonly labels: Record<string, string>
  readonly annotations: Record<string, string>
  /** Instance that holds it, which namespaces the id */
  readonly connectorId: number
  /** Where the source shows this condition in full */
  readonly href: string
  /** Least severe level this source was set to report */
  readonly floor: SignalSeverity
  /** Whether the always-firing heartbeat alert is kept off the portal */
  readonly hideWatchdog: boolean
  /** ISO timestamp of when it started firing */
  readonly since?: string
}

/**
 * Applies what the portal reports to one alert, whichever road it arrived by.
 *
 * Shared between the rules a Prometheus evaluates and the alerts an Alertmanager holds, because
 * which of the two is being read says nothing about whether a condition is worth a line: the
 * filter is the portal's, and only the fields around it differ.
 * @param {SignalSource} source - One alert, already reduced to what the filter reads
 * @returns {Signal | undefined} - The signal, or undefined when it is filtered out
 */
export function signalFrom(source: SignalSource): Signal | undefined {
  const name = source.labels.alertname?.trim()
  if (!name) {
    return undefined
  }

  const heartbeat = HEARTBEATS.has(name.toLowerCase())

  if (heartbeat && source.hideWatchdog) {
    return undefined
  }

  // A heartbeat asked for is shown whatever it is labelled and wherever the floor sits. It has to
  // be: the stock one carries `severity: none`, which is not a level at all, so reading its label
  // would mean the box that says to show it never does. It is drawn as the quietest thing on the
  // page, because a pipeline being alive is not an incident.
  const severity = heartbeat
    ? 'info'
    : SEVERITIES[source.labels.severity?.trim().toLowerCase() ?? '']

  if (!severity || (!heartbeat && !meetsFloor(severity, source.floor))) {
    return undefined
  }

  const detail = detailOf(source.annotations, source.labels)

  return {
    id: `${source.connectorId}:${fingerprint(source.labels)}`,
    severity,
    label: name,
    href: source.href,
    ...(detail ? { detail } : {}),
    ...(source.since ? { since: source.since } : {}),
  }
}
