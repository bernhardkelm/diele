import { config } from '#config.js'
import { getDb } from '#db/index.js'
import { readSecrets } from '#secrets/repository.js'
import { replaceEntries } from './entries.js'
import { messageOf, redactSecrets } from './redact.js'
import { moduleFor } from './registry.js'
import { readConnector } from './repository.js'

/** A source that has not answered in half a minute is not going to. */
const RUN_TIMEOUT_MS = 30_000

/** A revoked token then costs a couple of dozen requests a day rather than one every quarter. */
const MAX_BACKOFF_S = 60 * 60

/** A claim older than this belonged to a process that died mid-run, so it is not a claim. */
const STALE_CLAIM_S = 15 * 60

export interface SyncOutcome {
  readonly ok: boolean
  readonly entryCount: number
  readonly error?: string
}

/**
 * Claims a connector for this run, so a manual sync and the scheduler cannot collect the same
 * source twice at once. A claim left behind by a process that died is taken over rather than
 * waited on forever.
 * @param {number} connectorId - Connector to claim
 * @returns {boolean} - True when this caller may run it
 */
function claim(connectorId: number): boolean {
  const db = getDb()

  // A connector that arrived through an import has no sync row yet, and without one the claim
  // would match nothing and the connector would never run.
  db.prepare('INSERT OR IGNORE INTO connector_sync (connector_id) VALUES (?)').run(connectorId)

  const result = db
    .prepare(
      `UPDATE connector_sync
       SET running_since = datetime('now'), last_run_at = datetime('now')
       WHERE connector_id = @connectorId
         AND (running_since IS NULL OR running_since < datetime('now', @stale))`,
    )
    .run({ connectorId, stale: `-${STALE_CLAIM_S} seconds` })

  return result.changes === 1
}

/**
 * Records a run that produced entries, clearing the failure count so the interval returns to
 * what the connector asked for.
 * @param {number} connectorId - Connector that ran
 * @param {number} entryCount - How many entries it holds afterwards
 * @param {number} intervalSeconds - The connector's own interval
 * @param {string | null} cursor - What the run handed back for the next one
 * @returns {void}
 */
function recordSuccess(
  connectorId: number,
  entryCount: number,
  intervalSeconds: number,
  cursor: string | null,
): void {
  getDb()
    .prepare(
      `UPDATE connector_sync
       SET running_since = NULL, last_ok_at = datetime('now'), last_error = NULL,
           entry_count = @entryCount, failures = 0, cursor = @cursor,
           next_run_at = datetime('now', @interval)
       WHERE connector_id = @connectorId`,
    )
    .run({
      connectorId,
      entryCount,
      cursor,
      interval: `+${intervalSeconds} seconds`,
    })
}

/**
 * Records a failed run and backs the next one off, doubling per consecutive failure up to an
 * hour. The entries the last good run produced are deliberately left standing.
 * @param {number} connectorId - Connector that failed
 * @param {string} error - Message to show, already redacted
 * @param {number} intervalSeconds - The connector's own interval
 * @returns {void}
 */
function recordFailure(connectorId: number, error: string, intervalSeconds: number): void {
  const db = getDb()
  const row = db
    .prepare('SELECT failures FROM connector_sync WHERE connector_id = ?')
    .get(connectorId) as { failures: number } | undefined

  const failures = (row?.failures ?? 0) + 1
  const delay = Math.min(intervalSeconds * 2 ** failures, MAX_BACKOFF_S)

  db.prepare(
    `UPDATE connector_sync
     SET running_since = NULL, last_error = @error, failures = @failures,
         next_run_at = datetime('now', @delay)
     WHERE connector_id = @connectorId`,
  ).run({ connectorId, error, failures, delay: `+${delay} seconds` })
}

/**
 * Runs one connector's `collect` and writes what it produced. Every failure path leaves the
 * previous entries in place: a list that is a quarter of an hour old is closer to the truth
 * than an empty section, and an expired token is reported rather than acted on.
 * @param {number} connectorId - Connector to sync
 * @returns {Promise<SyncOutcome>} - What the run did
 */
export async function runSync(connectorId: number): Promise<SyncOutcome> {
  const connector = readConnector(connectorId)
  const module = moduleFor(connector.type)

  if (!module?.collect) {
    return { ok: false, entryCount: 0, error: 'this connector produces no entries' }
  }

  if (!config.secrets.available && module.secretKeys.length > 0) {
    return {
      ok: false,
      entryCount: 0,
      error: 'no encryption key is configured, so stored credentials cannot be read',
    }
  }

  if (!claim(connectorId)) {
    return { ok: false, entryCount: 0, error: 'a sync is already running' }
  }

  const secrets = readSecrets(connectorId)

  try {
    const result = await module.collect({
      id: connector.id,
      label: connector.label,
      config: connector.config,
      secrets,
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      cursor: null,
    })

    const entryCount = replaceEntries(connectorId, connector.type, result.entries, {
      partial: result.partial,
    })

    recordSuccess(connectorId, entryCount, connector.syncIntervalSeconds, result.cursor ?? null)

    return { ok: true, entryCount }
  } catch (cause) {
    const error = redactSecrets(messageOf(cause), secrets)
    recordFailure(connectorId, error, connector.syncIntervalSeconds)
    console.warn(`[connectors] ${connector.type}/${connector.label} sync failed:`, error)

    return { ok: false, entryCount: 0, error }
  }
}
