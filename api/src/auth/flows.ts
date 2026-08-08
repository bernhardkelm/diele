import { getDb } from '#db/index.js'

// A login handshake only has to survive the trip to the issuer and back.
const FLOW_TTL = '+10 minutes'

export interface AuthFlow {
  readonly codeVerifier: string
  readonly nonce: string
  readonly redirectTo: string | null
  readonly remember: boolean
}

interface FlowRow {
  code_verifier: string
  nonce: string
  redirect_to: string | null
  remember: number
}

/**
 * Stores what a login handshake will need when the browser comes back, keyed by the state the
 * issuer echoes. In the database rather than in memory, so a restart mid-login does not strand
 * whoever is at the issuer's screen.
 * @param {string} state - Value the issuer will echo on the callback
 * @param {AuthFlow} flow - Verifier, nonce and where to return afterwards
 * @returns {void}
 */
export function beginFlow(state: string, flow: AuthFlow): void {
  getDb()
    .prepare(
      `INSERT INTO auth_flows (state, code_verifier, nonce, redirect_to, expires_at, remember)
       VALUES (?, ?, ?, ?, datetime('now', ?), ?)`,
    )
    .run(state, flow.codeVerifier, flow.nonce, flow.redirectTo, FLOW_TTL, flow.remember ? 1 : 0)
}

/**
 * Reads a handshake back and removes it in the same call. Single use whether or not the exchange
 * that follows succeeds, so a replayed callback finds nothing.
 * @param {string} state - Value the issuer echoed
 * @returns {AuthFlow | undefined} - The stored handshake, or undefined when unknown or expired
 */
export function consumeFlow(state: string): AuthFlow | undefined {
  const db = getDb()

  const row = db
    .prepare(
      `SELECT code_verifier, nonce, redirect_to, remember FROM auth_flows
       WHERE state = ? AND expires_at > datetime('now')`,
    )
    .get(state) as FlowRow | undefined

  db.prepare('DELETE FROM auth_flows WHERE state = ?').run(state)

  if (!row) {
    return undefined
  }

  return {
    codeVerifier: row.code_verifier,
    nonce: row.nonce,
    redirectTo: row.redirect_to,
    remember: row.remember === 1,
  }
}
