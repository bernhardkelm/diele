import { z } from 'zod'
import { isHttpUrl } from '#fieldSchemas.js'
import type { ApiFieldSpec } from '@diele/common'
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
    required: true,
    hint: 'created under Settings → API Keys; stored encrypted and never returned',
  },
]

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
 * Checks that the key reaches this instance's metrics before anything is stored.
 *
 * A 200 is not enough on its own: an origin that is not a Kuma answers one for its own front
 * page, and the connector would then be saved against something that will never report a
 * monitor. The body has to carry the metric.
 * @param {VerifyContext} context - Validated config, the submitted credentials and a deadline
 * @returns {Promise<void>}
 */
async function verify(context: VerifyContext): Promise<void> {
  const { baseUrl } = configSchema.parse(context.config)

  const apiKey = context.secrets.apiKey
  if (!apiKey) {
    throw new Error('no API key was given')
  }

  const body = await fetchMetrics(baseUrl, apiKey, context.signal)

  if (!body.includes('monitor_status')) {
    throw new Error('this answered without any monitors, so it is either empty or not a Kuma')
  }
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

  const apiKey = context.secrets.apiKey
  if (!apiKey) {
    throw new Error('no API key is stored for this connector')
  }

  const monitors = parseMonitors(await fetchMetrics(baseUrl, apiKey, context.signal))
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
  resolveHealth,
}
