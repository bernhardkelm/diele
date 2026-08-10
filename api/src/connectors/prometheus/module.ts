import { z } from 'zod'
import { isHttpUrl } from '#fieldSchemas.js'
import { messageOf } from '#connectors/redact.js'
import { mapLimit } from '#health/pool.js'
import type { ApiFieldSpec } from '@diele/common'
import { instantQuery } from './client.js'
import { readingOf } from './map.js'
import type {
  ConnectorContext,
  ConnectorModule,
  HealthReading,
  HealthRequest,
  VerifyContext,
} from '#connectors/types.js'

/** Each bound entry is a query of its own, so a portal full of them stays polite to one box. */
const CONCURRENCY = 5

const FIELDS: ReadonlyArray<ApiFieldSpec> = [
  {
    key: 'baseUrl',
    label: 'Instance',
    input: 'url',
    required: true,
    placeholder: 'https://prometheus.example.com',
    hint: 'origin only; the query api is found under it',
  },
  {
    key: 'token',
    label: 'Bearer token',
    input: 'secret',
    hint: 'only where the instance asks for one; stored encrypted and never returned',
  },
]

const configSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .refine(isHttpUrl, 'must be an absolute http(s) url')
    // trailing slashes would double up in every url built from this
    .transform((value) => value.replace(/\/+$/, '')),
})

/**
 * Checks that the query api answers before anything is stored. `query=1` is the cheapest
 * expression there is and still exercises the whole path: the origin, the auth and the parser.
 * @param {VerifyContext} context - Validated config, the submitted credentials and a deadline
 * @returns {Promise<void>}
 */
async function verify(context: VerifyContext): Promise<void> {
  const { baseUrl } = configSchema.parse(context.config)

  await instantQuery(baseUrl, '1', context.secrets.token, context.signal)
}

/**
 * Runs each bound entry's own query. Unlike Kuma there is nothing to batch: the expressions are
 * arbitrary and unrelated, so this is one request per entry, capped and running in parallel.
 *
 * A query that fails costs its own dot rather than the batch: one typo should not take down
 * every other card's reading.
 * @param {ConnectorContext} context - Validated config, decrypted credentials and the signal
 * @param {ReadonlyArray<HealthRequest>} requests - Entries bound to this instance
 * @returns {Promise<ReadonlyMap<string, HealthReading>>} - Reading per entry ref
 */
async function resolveHealth(
  context: ConnectorContext,
  requests: ReadonlyArray<HealthRequest>,
): Promise<ReadonlyMap<string, HealthReading>> {
  const { baseUrl } = configSchema.parse(context.config)
  const token = context.secrets.token

  const bound = requests.filter((request) => Boolean(request.selector))

  const results = await mapLimit(bound, CONCURRENCY, async (request) => {
    try {
      return readingOf(
        await instantQuery(baseUrl, request.selector as string, token, context.signal),
      )
    } catch (cause) {
      const detail = messageOf(cause)

      // `unknown` rather than nothing: a query that could not be run says nothing about the
      // service, but a dot that is silently never there says nothing at all. Both an
      // unreachable instance and an expression Prometheus rejected land here, and neither is
      // an outage to report as one.
      console.warn(`[prometheus] ${request.ref} could not be queried:`, detail)

      return { state: 'unknown' as const, detail }
    }
  })

  const readings = new Map<string, HealthReading>()

  bound.forEach((request, index) => {
    const reading = results[index]
    if (reading) {
      readings.set(request.ref, reading)
    }
  })

  return readings
}

export const prometheusModule: ConnectorModule = {
  // Shadows the planned row of the same id, which is what takes it out of the admin list
  type: 'prometheus',
  label: 'Prometheus',
  description: 'Card and site states from a query of your own.',
  mark: 'pr',
  // Decorates entries someone else produced rather than supplying any of its own
  produces: [],
  fields: FIELDS,
  healthSelectorField: {
    key: 'healthQuery',
    label: 'Query',
    input: 'text',
    required: true,
    placeholder: 'up{job="nextcloud"}',
    hint: 'PromQL; non-zero is up, zero is down, an empty result leaves the dot off. One request per bound entry on every refresh',
  },
  secretKeys: ['token'],
  parseConfig: (input) => configSchema.parse(input),
  defaultIntervalSeconds: 60,
  verify,
  resolveHealth,
}
