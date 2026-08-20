import { z } from 'zod'
import { isHttpUrl } from '#fieldSchemas.js'
import { messageOf, redactSecrets } from '#connectors/redact.js'
import { mapLimit } from '#health/pool.js'
import { DEFAULT_FLOOR } from '#signals/severity.js'
import type { ApiFieldSpec } from '@diele/common'
import { instantQuery, listAlerts, listManagedAlerts, QueryRejectedError } from './client.js'
import { signalsOf } from './alerts.js'
import { managedSignalsOf } from './managedAlerts.js'
import { readingOf } from './map.js'
import type {
  ConnectorContext,
  ConnectorModule,
  HealthReading,
  HealthRequest,
  Signal,
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
  {
    key: 'alertmanagerUrl',
    label: 'Alertmanager',
    input: 'url',
    placeholder: 'https://alertmanager.example.com',
    hint: 'optional; alerts are then read from here instead, so silences count and an HA pair is one alert',
  },
  {
    key: 'minSeverity',
    label: 'Alerts from',
    input: 'select',
    default: DEFAULT_FLOOR,
    options: [
      { value: 'critical', label: 'Critical only' },
      { value: 'warning', label: 'Warning and critical' },
      { value: 'info', label: 'Info and up, everything it reports' },
    ],
    hint: 'the least severe level that reaches the portal',
  },
  {
    key: 'hideWatchdog',
    label: 'Hide Watchdog',
    input: 'toggle',
    default: true,
    hint: 'it fires forever by design, so it is noise; leave it showing to prove the path is up',
  },
]

// trailing slashes would double up in every url built from this
const origin = z
  .string()
  .trim()
  .min(1)
  .refine(isHttpUrl, 'must be an absolute http(s) url')
  .transform((value) => value.replace(/\/+$/, ''))

const configSchema = z.object({
  baseUrl: origin,
  // An empty box is no Alertmanager rather than an invalid one, so clearing the field is how it
  // is switched back off.
  alertmanagerUrl: z
    .union([origin, z.literal('')])
    .optional()
    .transform((value) => value || undefined),
  // A row stored before the choice existed carries no value, and keeps what it already reported
  minSeverity: z.enum(['info', 'warning', 'critical']).default(DEFAULT_FLOOR),
  hideWatchdog: z.boolean().default(true),
})

/**
 * Checks that the query api answers before anything is stored. `query=1` is the cheapest
 * expression there is and still exercises the whole path: the origin, the auth and the parser.
 *
 * An Alertmanager that has been named is checked too, so a typo in that box is caught while
 * someone is still looking at the form rather than showing up as a line that never appears.
 * @param {VerifyContext} context - Validated config, the submitted credentials and a deadline
 * @returns {Promise<void>}
 */
async function verify(context: VerifyContext): Promise<void> {
  const { baseUrl, alertmanagerUrl } = configSchema.parse(context.config)

  await instantQuery(baseUrl, '1', context.secrets.token, context.signal)

  if (alertmanagerUrl) {
    await listManagedAlerts(alertmanagerUrl, context.secrets.token, context.signal)
  }
}

/**
 * Runs each bound entry's own query. Unlike Kuma there is nothing to batch: the expressions are
 * arbitrary and unrelated, so this is one request per entry, capped and running in parallel.
 *
 * A query that fails costs its own dot rather than the batch: one typo should not take down
 * every other card's reading. Throws only where nothing answered and the instance is why, so a
 * decorator that has stopped working is recorded as such instead of reading as healthy.
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

  let answered = 0
  const faults: string[] = []

  const results = await mapLimit(bound, CONCURRENCY, async (request) => {
    try {
      const data = await instantQuery(baseUrl, request.selector as string, token, context.signal)
      answered += 1

      return readingOf(data)
    } catch (cause) {
      const detail = redactSecrets(messageOf(cause), context.secrets)

      // A rejected expression is the query's fault and the instance is fine, so only the rest
      // counts towards the connector itself having stopped working.
      if (!(cause instanceof QueryRejectedError)) {
        faults.push(`${request.ref}: ${detail}`)
      }

      // `unknown` rather than nothing: a query that could not be run says nothing about the
      // service, but a dot that is silently never there says nothing at all. Both an
      // unreachable instance and an expression Prometheus rejected land here, and neither is
      // an outage to report as one.
      console.warn(`[prometheus] ${request.ref} could not be queried:`, detail)

      return { state: 'unknown' as const, detail }
    }
  })

  // Nothing answered and the instance is why: raised so the panel can say the connector stopped
  // working, which a per-entry `unknown` never does. `askConnector` still draws every dot.
  if (answered === 0 && faults.length > 0) {
    throw new Error(`no query could be run (${faults.join('; ')})`)
  }

  const readings = new Map<string, HealthReading>()

  bound.forEach((request, index) => {
    const reading = results[index]
    if (reading) {
      readings.set(request.ref, reading)
    }
  })

  return readings
}

/**
 * Reads what is currently firing. One request whatever is bound, unlike the per-entry queries
 * above: an alert belongs to no card, so there is nothing to run once per entry.
 *
 * An Alertmanager wins where one is named, because it knows two things the instance behind it
 * cannot: which alerts have been silenced, and which arrived from somewhere other than this
 * Prometheus' own rules. Without one the rules are all there is to read, which is the whole of
 * what a lone Prometheus knows.
 *
 * Throws rather than swallowing, so a source that cannot be reached is recorded as such instead
 * of reading as nothing being wrong, which is the one thing a quiet alert line must never mean.
 * @param {ConnectorContext} context - Validated config, decrypted credentials and the signal
 * @returns {Promise<ReadonlyArray<Signal>>} - What is firing
 */
async function readSignals(context: ConnectorContext): Promise<ReadonlyArray<Signal>> {
  const { baseUrl, alertmanagerUrl, minSeverity, hideWatchdog } = configSchema.parse(context.config)
  const token = context.secrets.token
  const reported = { connectorId: context.id, floor: minSeverity, hideWatchdog }

  if (alertmanagerUrl) {
    const managed = await listManagedAlerts(alertmanagerUrl, token, context.signal)

    return managedSignalsOf(managed, { ...reported, baseUrl: alertmanagerUrl })
  }

  const alerts = await listAlerts(baseUrl, token, context.signal)

  return signalsOf(alerts, { ...reported, baseUrl })
}

export const prometheusModule: ConnectorModule = {
  // Shadows the planned row of the same id, which is what takes it out of the admin list
  type: 'prometheus',
  label: 'Prometheus',
  description: 'Card and site states from a query of your own, and the alerts its rules fire.',
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
  readSignals,
}
