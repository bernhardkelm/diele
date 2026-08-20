import { config } from '#config.js'
import { messageOf, redactSecrets } from '#connectors/redact.js'
import { moduleFor } from '#connectors/registry.js'
import { listEnabledConnectors, recordHealthRead } from '#connectors/repository.js'
import type { Signal } from '#connectors/types.js'
import { readSecrets } from '#secrets/repository.js'
import { isEnabled } from '#settings/toggles.js'

/** A source that has not answered in this long is not going to before the client asks again. */
const READ_TIMEOUT_MS = 15_000

export interface SignalTask {
  /** The connector this reads, which is also its cache key */
  readonly key: string
  /** Which connector that is, for the sweep that reads the ids it namespaces */
  readonly connectorId: number
  readonly ttlSeconds: number
  readonly run: () => Promise<ReadonlyArray<Signal>>
}

/**
 * Asks one connector what it currently holds.
 *
 * Throws where it could not be asked at all, which the cache tells apart from an answer of
 * nothing: a source that cannot be reached knows nothing about whether anything is wrong, and
 * serving that as an empty list would say everything is fine on exactly the evidence that says
 * nothing at all.
 * @param {number} connectorId - Connector to ask
 * @returns {Promise<ReadonlyArray<Signal>>} - What it reports as firing
 */
async function askConnector(connectorId: number): Promise<ReadonlyArray<Signal>> {
  const connector = listEnabledConnectors().find((entry) => entry.id === connectorId)
  const module = connector ? moduleFor(connector.type) : undefined

  if (!connector || !module?.readSignals) {
    return []
  }

  // A deployment that cannot open this connector's credentials will never read it, so this says
  // so rather than reporting an instance nobody can reach as quiet.
  if (!config.secrets.available && module.secretKeys.length > 0) {
    throw new Error('DIELE_SECRET_KEYS is unset, so its credentials cannot be read')
  }

  const secrets = readSecrets(connectorId)

  try {
    const signals = await module.readSignals({
      id: connector.id,
      label: connector.label,
      config: connector.config,
      secrets,
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      cursor: null,
    })

    recordHealthRead(connectorId, null)

    return signals
  } catch (cause) {
    const error = redactSecrets(messageOf(cause), secrets)

    // Recorded as well as thrown, so the panel says which instance stopped answering. Shared with
    // the readings deliberately: both are this connector being reachable, and a source that is
    // down for one is down for the other.
    recordHealthRead(connectorId, error)

    console.warn(`[signals] ${connector.type}/${connector.label} could not be read:`, error)

    throw new Error(error)
  }
}

/**
 * Plans a read of every connector that reports signals.
 *
 * Empty while the feature is switched off, which is what stops the portal reaching anything at
 * all rather than merely hiding a line it already fetched.
 * @returns {ReadonlyArray<SignalTask>} - One task per connector that can be asked
 */
export function listSignalTasks(): ReadonlyArray<SignalTask> {
  if (!isEnabled('alerts')) {
    return []
  }

  return listEnabledConnectors()
    .filter((connector) => isEnabled(connector.type) && moduleFor(connector.type)?.readSignals)
    .map((connector) => ({
      key: String(connector.id),
      connectorId: connector.id,
      ttlSeconds: connector.syncIntervalSeconds,
      run: () => askConnector(connector.id),
    }))
}
