import { createApp } from './app.js'
import { pruneExpired } from './auth/session.js'
import { announceSetup } from './auth/setup.js'
import { config } from './config.js'
import { startConnectorScheduler, stopConnectorScheduler } from './connectors/scheduler.js'
import { closeDb, getDb } from './db/index.js'
import { closeHistoryDb } from './history/db.js'
import { pruneHistory } from './history/prune.js'

// Every fifteen minutes, matching the shortest window anything here keeps. Pruning only at boot
// left expired sessions and failed logins accumulating for the life of the process, and the
// failed logins arrive from callers who have not signed in.
const PRUNE_EVERY_MS = 15 * 60_000

// Opening the database also migrates it, so a schema problem stops the process here rather
// than surfacing on the first request.
getDb()

/**
 * Sweeps what has expired: sessions, sign-in attempts and history past its retention.
 * @returns {void}
 */
function prune(): void {
  pruneExpired()

  // Caught here because it is a second file: a history database that cannot be written must not
  // take down the portal whose sessions the line above just swept.
  try {
    pruneHistory()
  } catch (cause) {
    console.error('[diele] pruning history failed, continuing:', cause)
  }
}

prune()

// Unref'd so a pending sweep never holds the process open.
setInterval(prune, PRUNE_EVERY_MS).unref()

// Last resort behind the handlers each background job already carries. Without it a rejection
// nobody awaited ends the process, and a portal serving everyone should not be taken down by a
// job it was running for itself.
process.on('unhandledRejection', (reason) => {
  console.error('[diele] unhandled rejection, continuing:', reason)
})

const app = createApp()

const server = app.listen(config.port, () => {
  console.log(`diele api listening on :${config.port} (auth: ${config.authMode})`)

  if (config.authMode === 'dev') {
    console.warn('AUTH_MODE=dev: every login is granted as a fixed local identity')
  }

  announceSetup()

  // Started here rather than at import, so a slow source cannot delay the port opening and
  // importing the app in a test starts no timers.
  startConnectorScheduler()
})

/**
 * Stops taking requests, then closes the database once the ones in flight have answered.
 * @param {NodeJS.Signals} signal - Signal that asked for the shutdown
 * @returns {void}
 */
function shutdown(signal: NodeJS.Signals): void {
  console.log(`diele api stopping on ${signal}`)
  stopConnectorScheduler()

  server.close(() => {
    closeDb()
    closeHistoryDb()
    process.exit(0)
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
