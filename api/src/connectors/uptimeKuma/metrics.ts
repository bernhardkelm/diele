import type { HealthState } from '@diele/common'

/** Kuma's own status codes, as its `monitor_status` help line documents them. */
const STATES: Record<string, HealthState> = {
  '0': 'down',
  '1': 'up',
  '2': 'pending',
  '3': 'maintenance',
}

// Kuma writes unset labels as the literal string, so an http monitor carries
// `monitor_hostname="null"` rather than leaving the label out.
const UNSET = 'null'

const LINE = /^monitor_status\{(.*)\}\s+(\S+)\s*$/
const LABEL = /(\w+)="((?:[^"\\]|\\.)*)"/g

export interface KumaMonitor {
  readonly name: string
  readonly url?: string
  readonly hostname?: string
  readonly state: HealthState
}

/**
 * Reverses the escaping the Prometheus text format applies to a label value.
 * @param {string} value - Label value as written
 * @returns {string} - The value it stands for
 */
function unescape(value: string): string {
  return value.replace(/\\(.)/g, (_match, char: string) => {
    if (char === 'n') {
      return '\n'
    }

    return char
  })
}

/**
 * Reads the labels of one sample.
 * @param {string} block - What stood between the braces
 * @returns {Record<string, string>} - Labels, unescaped, with Kuma's `null` treated as absent
 */
function labelsOf(block: string): Record<string, string> {
  const labels: Record<string, string> = {}

  for (const match of block.matchAll(LABEL)) {
    const value = unescape(match[2] as string)
    if (value !== '' && value !== UNSET) {
      labels[match[1] as string] = value
    }
  }

  return labels
}

/**
 * Reads the monitors out of Kuma's `/metrics` body.
 *
 * Only `monitor_status` is looked at: the same endpoint carries response times and certificate
 * expiry, neither of which a dot reports. Parsed rather than pulled in with a Prometheus client,
 * because one metric of one shape is a regex and a library would be the larger dependency.
 * @param {string} body - Response body in the Prometheus text exposition format
 * @returns {ReadonlyArray<KumaMonitor>} - One entry per monitor with a readable status
 */
export function parseMonitors(body: string): ReadonlyArray<KumaMonitor> {
  const monitors: KumaMonitor[] = []

  for (const line of body.split('\n')) {
    if (line.startsWith('#')) {
      continue
    }

    const matched = LINE.exec(line)
    if (!matched) {
      continue
    }

    const state = STATES[(matched[2] as string).trim()]
    if (!state) {
      continue
    }

    const labels = labelsOf(matched[1] as string)
    const name = labels.monitor_name
    if (!name) {
      continue
    }

    monitors.push({
      name,
      state,
      ...(labels.monitor_url ? { url: labels.monitor_url } : {}),
      ...(labels.monitor_hostname ? { hostname: labels.monitor_hostname } : {}),
    })
  }

  return monitors
}
