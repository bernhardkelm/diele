import { getDb } from '#db/index.js'

/**
 * Reads the silences that apply to one person: the portal's own, and their own.
 *
 * Two scopes but one action, unlike a hidden entry: who is asking decides which of the two a
 * silence lands in, so nobody has to be taught the difference before they can quieten a line.
 * @param {number} userId - Whoever is asking
 * @returns {ReadonlySet<string>} - Signal ids not to show them
 */
export function readSilenced(userId: number): ReadonlySet<string> {
  const rows = getDb()
    .prepare('SELECT signal_id FROM signal_silences WHERE user_id IS NULL OR user_id = ?')
    .all(userId) as Array<{ signal_id: string }>

  return new Set(rows.map((row) => row.signal_id))
}

/**
 * Quietens one signal, or brings it back.
 *
 * An admin silences it for the portal and everyone else silences it for themselves, which is the
 * same choice a hidden entry offers and the same rule about who may make it. The difference is
 * that it is one action rather than two: an alert is a fact about the house, so an admin saying
 * "we know" is the portal knowing.
 * @param {string} signalId - Signal being quietened, as the source built its id
 * @param {number} userId - Whoever is asking
 * @param {boolean} forEveryone - True where they may speak for the portal
 * @param {boolean} silenced - True to quieten it, false to bring it back
 * @returns {void}
 */
export function setSilenced(
  signalId: string,
  userId: number,
  forEveryone: boolean,
  silenced: boolean,
): void {
  const db = getDb()
  const owner = forEveryone ? null : userId

  if (!silenced) {
    // Only their own scope: an admin bringing one back does not un-silence what somebody else
    // quietened for themselves, and a member cannot lift the portal's.
    db.prepare(
      'DELETE FROM signal_silences WHERE signal_id = ? AND COALESCE(user_id, 0) = COALESCE(?, 0)',
    ).run(signalId, owner)
    return
  }

  db.prepare(
    `INSERT INTO signal_silences (signal_id, user_id) VALUES (?, ?)
     ON CONFLICT (signal_id, COALESCE(user_id, 0)) DO NOTHING`,
  ).run(signalId, owner)
}

/**
 * Forgets the silences of one source's conditions that are no longer firing.
 *
 * A silence lasts as long as the alert does. Somebody saying they know about this outage is not
 * saying they want to be kept from hearing about the next one, and a list that grew forever
 * would eventually hide a condition nobody alive had silenced.
 *
 * Swept per source and only against a run that answered, which is what the namespaced ids are
 * for: a source that could not be reached this time reports nothing, and reading that as "none of
 * its alerts are firing" would drop every silence the moment it went down.
 * @param {number} connectorId - Source whose answer this is
 * @param {ReadonlyArray<string>} liveIds - Signal ids it is currently reporting
 * @returns {void}
 */
export function sweepSilences(connectorId: number, liveIds: ReadonlyArray<string>): void {
  const db = getDb()
  const prefix = `${connectorId}:`

  if (liveIds.length === 0) {
    db.prepare('DELETE FROM signal_silences WHERE signal_id LIKE ? || ?').run(prefix, '%')
    return
  }

  const holes = liveIds.map(() => '?').join(', ')

  db.prepare(
    `DELETE FROM signal_silences
     WHERE signal_id LIKE ? || '%' AND signal_id NOT IN (${holes})`,
  ).run(prefix, ...liveIds)
}
