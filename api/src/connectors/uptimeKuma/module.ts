import { z } from 'zod'
import { isHttpUrl } from '#fieldSchemas.js'
import type { ApiFieldOption, ApiFieldSpec } from '@diele/common'
import { fetchMetrics } from './client.js'
import { indexMonitors, readingFor } from './map.js'
import { parseMonitors } from './metrics.js'
import type {
  ConnectorContext,
  ConnectorModule,
  HealthReading,
  HealthRequest,
  VerifyContext,
} from '#connectors/types.js'

const FIELDS: ReadonlyArray<ApiFieldSpec> = [
  {
    key: 'baseUrl',
    label: 'Instance',
    input: 'url',
    required: true,
    placeholder: 'https://uptime.example.com',
    hint: 'origin only; where Uptime Kuma itself is served',
  },
  {
    key: 'apiKey',
    label: 'API key',
    input: 'secret',
    hint: 'only where the instance asks for one; created under Settings → API Keys, stored encrypted and never returned',
  },
]

/**
 * How long a monitor list stands. The admin panel re-reads its features after every write, and
 * a list of monitor names does not change between two of them.
 */
const TARGETS_TTL_MS = 30_000

interface CachedTargets {
  readonly at: number
  /** Held alongside, so pointing the connector at another instance misses rather than hits */
  readonly baseUrl: string
  readonly options: ReadonlyArray<ApiFieldOption>
}

const targetCache = new Map<number, CachedTargets>()

const configSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .refine(isHttpUrl, 'must be an absolute http(s) url')
    // trailing slashes would double up in the metrics url built from this
    .transform((value) => value.replace(/\/+$/, '')),
})

/**
 * Checks that this instance's metrics can be reached before anything is stored.
 *
 * A 200 is not enough on its own: an origin that is not a Kuma answers one for its own front
 * page, and the connector would then be saved against something that will never report a
 * monitor. The body has to carry the metric.
 * @param {VerifyContext} context - Validated config, the submitted credentials and a deadline
 * @returns {Promise<void>}
 */
async function verify(context: VerifyContext): Promise<void> {
  const { baseUrl } = configSchema.parse(context.config)

  const body = await fetchMetrics(baseUrl, context.secrets.apiKey, context.signal)

  if (!body.includes('monitor_status')) {
    throw new Error('this answered without any monitors, so it is either empty or not a Kuma')
  }
}

/**
 * Lists this instance's monitors, so an entry is bound by picking one rather than by typing its
 * name to the letter. Names rather than ids, because that is what a binding stores and what
 * `readingFor` matches on.
 * @param {ConnectorContext} context - Validated config, decrypted credentials and the signal
 * @returns {Promise<ReadonlyArray<ApiFieldOption>>} - One option per monitor, by name
 */
async function listHealthTargets(
  context: ConnectorContext,
): Promise<ReadonlyArray<ApiFieldOption>> {
  const { baseUrl } = configSchema.parse(context.config)

  const cached = targetCache.get(context.id)
  if (cached && cached.baseUrl === baseUrl && Date.now() - cached.at < TARGETS_TTL_MS) {
    return cached.options
  }

  const monitors = parseMonitors(
    await fetchMetrics(baseUrl, context.secrets.apiKey, context.signal),
  )

  const names = [...new Set(monitors.map((monitor) => monitor.name.trim()).filter(Boolean))]
  const options = names
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }))

  targetCache.set(context.id, { at: Date.now(), baseUrl, options })

  return options
}

/**
 * Reads every monitor in one request and answers each bound entry from it. One request per
 * refresh however many entries are bound, which is what `resolveHealth` taking the whole batch
 * is for.
 * @param {ConnectorContext} context - Validated config, decrypted credentials and the signal
 * @param {ReadonlyArray<HealthRequest>} requests - Entries bound to this instance
 * @returns {Promise<ReadonlyMap<string, HealthReading>>} - Reading per entry ref
 */
async function resolveHealth(
  context: ConnectorContext,
  requests: ReadonlyArray<HealthRequest>,
): Promise<ReadonlyMap<string, HealthReading>> {
  const { baseUrl } = configSchema.parse(context.config)

  const monitors = parseMonitors(
    await fetchMetrics(baseUrl, context.secrets.apiKey, context.signal),
  )
  const lookups = indexMonitors(monitors)
  const readings = new Map<string, HealthReading>()

  for (const request of requests) {
    const reading = readingFor(request, lookups)
    if (reading) {
      readings.set(request.ref, reading)
    }
  }

  return readings
}

export const uptimeKumaModule: ConnectorModule = {
  // Shadows the planned row of the same id, which is what takes it out of the admin list
  type: 'uptime-kuma',
  label: 'Uptime Kuma',
  description: 'Monitor states, shown as a dot on the cards and sites they belong to.',
  mark: 'uk',
  // Decorates entries someone else produced rather than supplying any of its own
  produces: [],
  fields: FIELDS,
  healthSelectorField: {
    key: 'healthMonitor',
    label: 'Monitor',
    input: 'text',
    placeholder: 'nextcloud',
    hint: 'monitor name; blank falls back to the entry’s hostname, then to its own name',
  },
  secretKeys: ['apiKey'],
  parseConfig: (input) => configSchema.parse(input),
  // Kuma writes a heartbeat about once a minute, so refreshing faster only adds load
  defaultIntervalSeconds: 60,
  verify,
  listHealthTargets,
  resolveHealth,
}
