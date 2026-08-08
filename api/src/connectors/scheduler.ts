import { config } from '#config.js'
import { getDb } from '#db/index.js'
import { messageOf } from './redact.js'
import { moduleFor } from './registry.js'
import { runSync } from './sync.js'

/** Every connector's own interval is a minute or more, so this only decides how late a run is. */
const TICK_MS = 30_000

let timer: ReturnType<typeof setInterval> | undefined

/**
 * Returns the connectors whose next run is due, newest claim last so a long queue still moves.
 * @returns {ReadonlyArray<number>} - Connector ids to run
 */
function dueConnectors(): ReadonlyArray<number> {
  const rows = getDb()
    .prepare(
      `SELECT s.connector_id AS id, c.type
       FROM connector_sync s
       JOIN connectors c ON c.id = s.connector_id
       WHERE c.enabled = 1 AND s.running_since IS NULL AND s.next_run_at <= datetime('now')
       ORDER BY s.next_run_at`,
    )
    .all() as Array<{ id: number; type: string }>

  return rows.filter((row) => moduleFor(row.type)?.collect !== undefined).map((row) => row.id)
}

/**
 * Runs whatever is due, one at a time. Serial rather than concurrent: syncing is not urgent,
 * and better-sqlite3 is synchronous, so several runs finishing together would each block the
 * event loop for the length of their own write.
 * @returns {Promise<void>}
 */
async function tick(): Promise<void> {
  for (const id of dueConnectors()) {
    // `runSync` reads the connector, claims it and reads its secrets before its own try block, so
    // a row deleted between this tick's query and its turn in the queue throws here. The tick is
    // fired unawaited, which would make that an unhandled rejection and end the process.
    try {
      await runSync(id)
    } catch (cause) {
      console.warn(`[connectors] sync of connector ${id} could not start:`, messageOf(cause))
    }
  }
}

/**
 * Runs a tick and swallows whatever it could not handle. The scheduler is fired unawaited, so an
 * escaping rejection here would take the process down and with it everyone's portal, over a
 * background job nobody was waiting on.
 * @returns {Promise<void>}
 */
export async function runDueConnectors(): Promise<void> {
  try {
    await tick()
  } catch (cause) {
    console.error('[connectors] scheduler tick failed:', messageOf(cause))
  }
}

/**
 * Starts the connector scheduler. Called from the listen callback rather than at import, so a
 * slow source cannot delay the port opening and importing the app in a test starts no timers.
 * @returns {void}
 */
export function startConnectorScheduler(): void {
  if (timer !== undefined) {
    return
  }

  if (!config.secrets.available) {
    console.warn(
      '[connectors] no encryption key is configured, so nothing will sync. ' +
        'Set DIELE_SECRET_KEYS; entries already stored are still served.',
    )
    return
  }

  void runDueConnectors()

  // unref'd so a pending tick never holds the process open, the way the session sweep does
  timer = setInterval(() => void runDueConnectors(), TICK_MS)
  timer.unref()
}

/**
 * Stops the scheduler.
 * @returns {void}
 */
export function stopConnectorScheduler(): void {
  if (timer !== undefined) {
    clearInterval(timer)
  }

  timer = undefined
}
