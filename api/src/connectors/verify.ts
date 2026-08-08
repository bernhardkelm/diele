import { badRequest } from '#errors.js'
import { messageOf, redactSecrets } from './redact.js'
import type { ConnectorModule } from './types.js'

// Shorter than a run's budget: this sits between someone pressing Save and the form answering,
// so it has to fail while they are still looking at it.
const VERIFY_TIMEOUT_MS = 15_000

/**
 * Runs a module's connectivity check against settings that have not been stored yet, and turns
 * a failure into something the admin form can show.
 *
 * Nothing is written until this passes: a connector saved with a token that does not work would
 * otherwise sit there failing on a schedule, and the first anyone hears of it is an empty list.
 *
 * A module with no check of its own is stored as entered - there is nothing to ask.
 * @param {ConnectorModule} module - Module whose settings are being saved
 * @param {Record<string, unknown>} config - Validated config to test
 * @param {Record<string, string>} secrets - Credentials to test, decrypted
 * @returns {Promise<void>}
 */
export async function verifyConnector(
  module: ConnectorModule,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): Promise<void> {
  if (!module.verify) {
    return
  }

  try {
    await module.verify({ config, secrets, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) })
  } catch (cause) {
    // Redacted the same way a run's error is: the check talks to the same source, and its
    // message tends to echo the request that caused it.
    throw badRequest(
      `${module.label} could not be reached: ${redactSecrets(messageOf(cause), secrets)}`,
    )
  }
}
