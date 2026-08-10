import { config } from '#config.js'
import { messageOf, redactSecrets } from '#connectors/redact.js'
import { moduleFor } from '#connectors/registry.js'
import { listEnabledConnectors, recordHealthRead } from '#connectors/repository.js'
import type { HealthReading, HealthRequest } from '#connectors/types.js'
import { readSecrets } from '#secrets/repository.js'
import { isEnabled } from '#settings/toggles.js'
import { HTTP_TTL_SECONDS, probeAll } from './httpProbe.js'
import { HTTP_PROVIDER, providerValue } from './providers.js'
import { listBindings, readBinding, type HealthBinding } from './repository.js'
import { listTargets, type HealthTarget } from './targets.js'

/** A source that has not answered in this long is not going to before the client asks again. */
const RESOLVE_TIMEOUT_MS = 15_000

export interface ProviderTask {
  /** The provider's option value, which is also its cache key */
  readonly key: string
  /** Refs this task answers for, so the cache knows what a run of it replaces */
  readonly refs: ReadonlyArray<string>
  readonly ttlSeconds: number
  readonly run: () => Promise<ReadonlyMap<string, HealthReading>>
}

/**
 * Builds the request one binding turns into, or nothing when its target has gone away. A
 * binding outlives the row it points at only until whoever deleted that row sweeps it, and an
 * imported document can carry one for an entry a later sync has not produced yet.
 * @param {HealthBinding} binding - Binding to build from
 * @param {ReadonlyMap<string, HealthTarget>} targets - Everything bindable
 * @returns {HealthRequest | undefined} - The request, or undefined when nothing is there
 */
function requestFor(
  binding: HealthBinding,
  targets: ReadonlyMap<string, HealthTarget>,
): HealthRequest | undefined {
  const target = targets.get(binding.ref)
  if (!target) {
    return undefined
  }

  // A selector an import wrote blank is no selector, so it falls back the way a typed one does.
  const bound = binding.selector?.trim() ? binding.selector : null

  // The binding wins, then whatever produced the entry suggested. That fallback is what lets a
  // monitor named after a repo path decorate it without anyone typing the path twice. Not for the
  // built-in probe: there a selector is a path resolved against the entry's own url, so a repo
  // path would resolve into a url nobody asked for rather than probing the entry itself.
  const matched = binding.provider === HTTP_PROVIDER ? bound : (bound ?? target.healthRef)

  return {
    ref: binding.ref,
    url: target.url,
    label: target.label,
    ...(matched ? { selector: matched } : {}),
  }
}

/**
 * Marks every entry bound to a source that could not be reached.
 *
 * Not `down`, which is a claim about the service: a decorator that cannot be reached knows
 * nothing about what it watches, and painting those red would blame the wrong thing. Not nothing
 * either, which is what this used to do - a dot that vanishes is how a decorator stops working
 * without anyone noticing.
 * @param {ReadonlyArray<HealthRequest>} requests - Entries the source was asked about
 * @param {string} detail - Why it could not be reached, already redacted
 * @returns {ReadonlyMap<string, HealthReading>} - `unknown` for each of them
 */
function unreachable(
  requests: ReadonlyArray<HealthRequest>,
  detail: string,
): ReadonlyMap<string, HealthReading> {
  return new Map(requests.map((request) => [request.ref, { state: 'unknown' as const, detail }]))
}

/**
 * Runs one connector's `resolveHealth`, handing it the same context a sync gets.
 * @param {number} connectorId - Connector to ask
 * @param {ReadonlyArray<HealthRequest>} requests - Entries bound to it
 * @returns {Promise<ReadonlyMap<string, HealthReading>>} - Readings, `unknown` when it failed
 */
async function askConnector(
  connectorId: number,
  requests: ReadonlyArray<HealthRequest>,
): Promise<ReadonlyMap<string, HealthReading>> {
  const connector = listEnabledConnectors().find((entry) => entry.id === connectorId)
  const module = connector ? moduleFor(connector.type) : undefined

  if (!connector || !module?.resolveHealth) {
    return new Map()
  }

  // A deployment that cannot open this connector's credentials will never read it, so this is
  // reported the same way an unreachable one is rather than left as a row of missing dots.
  if (!config.secrets.available && module.secretKeys.length > 0) {
    return unreachable(requests, 'DIELE_SECRET_KEYS is unset, so its credentials cannot be read')
  }

  const secrets = readSecrets(connectorId)

  try {
    const readings = await module.resolveHealth(
      {
        id: connector.id,
        label: connector.label,
        config: connector.config,
        secrets,
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
        cursor: null,
      },
      requests,
    )

    recordHealthRead(connectorId, null)

    return readings
  } catch (cause) {
    const error = redactSecrets(messageOf(cause), secrets)

    // Recorded as well as logged: a decorator runs no sync, so this is the only thing that ever
    // says one stopped working, and a dot that quietly went missing says nothing on its own.
    recordHealthRead(connectorId, error)

    // Logged as well as carried: the message quotes the source's own response, which on an
    // internal instance names hosts and ports, so the copy on the reading is narrowed to an
    // admin by `readHealth` before it is served.
    console.warn(`[health] ${connector.type}/${connector.label} could not be read:`, error)

    return unreachable(requests, error)
  }
}

/**
 * Groups bindings into one task per provider, so a decorator that can answer for thirty entries
 * in one request is asked once rather than thirty times.
 * @param {ReadonlyArray<HealthBinding>} bindings - Bindings to resolve
 * @returns {ReadonlyArray<ProviderTask>} - One task per provider with something bound to it
 */
function buildTasks(bindings: ReadonlyArray<HealthBinding>): ReadonlyArray<ProviderTask> {
  const targets = listTargets()
  const grouped = new Map<string, { connectorId: number | null; requests: HealthRequest[] }>()

  for (const binding of bindings) {
    const request = requestFor(binding, targets)
    if (!request) {
      continue
    }

    const key = providerValue(binding.provider, binding.connectorId)
    const group = grouped.get(key) ?? { connectorId: binding.connectorId, requests: [] }
    group.requests.push(request)
    grouped.set(key, group)
  }

  const tasks: ProviderTask[] = []

  for (const [key, group] of grouped) {
    const refs = group.requests.map((request) => request.ref)

    if (key === HTTP_PROVIDER) {
      tasks.push({
        key,
        refs,
        ttlSeconds: HTTP_TTL_SECONDS,
        run: () => probeAll(group.requests),
      })
      continue
    }

    const connectorId = group.connectorId
    if (connectorId === null) {
      continue
    }

    const connector = listEnabledConnectors().find((entry) => entry.id === connectorId)
    if (!connector || !isEnabled(connector.type)) {
      continue
    }

    tasks.push({
      key,
      refs,
      ttlSeconds: connector.syncIntervalSeconds,
      run: () => askConnector(connectorId, group.requests),
    })
  }

  return tasks
}

/**
 * Plans a refresh of everything bound.
 *
 * Empty while the feature is switched off, which is what stops the portal reaching anything at
 * all rather than merely hiding the dots it already fetched.
 * @returns {ReadonlyArray<ProviderTask>} - One task per provider with something bound to it
 */
export function listProviderTasks(): ReadonlyArray<ProviderTask> {
  if (!isEnabled('health')) {
    return []
  }

  return buildTasks(listBindings())
}

/**
 * Plans a refresh of one entry alone, for someone who just bound it and is waiting to hear
 * whether it works. The same path a scheduled refresh takes, so what the panel reports on save
 * is what the portal will draw a moment later rather than a second opinion.
 * @param {string} ref - Entry to resolve
 * @returns {ProviderTask | undefined} - Its task, or undefined when nothing is bound to it
 */
export function taskForRef(ref: string): ProviderTask | undefined {
  if (!isEnabled('health')) {
    return undefined
  }

  const binding = readBinding(ref)

  return binding ? buildTasks([binding])[0] : undefined
}
