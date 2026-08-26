import type { SilencedIds } from '@diele/common'
import { getDb } from '#db/index.js'

/**
 * Reads the silences that apply to one person, kept in the two scopes they sit in.
 *
 * Split rather than merged, because the portal's own and their own are not lifted by the same
 * people: only an admin may bring back what the portal quietened, so a list offering everyone a
 * way back on every line would offer most of them one that does nothing.
 * @param {number} userId - Whoever is asking
 * @returns {SilencedIds} - Quietened for everyone, and quietened by them
 */
export function readSilencedScopes(userId: number): SilencedIds {
  const rows = getDb()
    .prepare('SELECT signal_id, user_id FROM signal_silences WHERE user_id IS NULL OR user_id = ?')
    .all(userId) as Array<{ signal_id: string; user_id: number | null }>

  return {
    all: rows.filter((row) => row.user_id === null).map((row) => row.signal_id),
    mine: rows.filter((row) => row.user_id !== null).map((row) => row.signal_id),
  }
}

/**
 * Reads the silences that apply to one person as one set, for a caller that only asks whether a
 * line is quietened at all rather than by whom.
 *
 * Two scopes but one action, unlike a hidden entry: who is asking decides which of the two a
 * silence lands in, so nobody has to be taught the difference before they can quieten a line.
 * @param {number} userId - Whoever is asking
 * @returns {ReadonlySet<string>} - Signal ids quietened for them, in either scope
 */
export function readSilenced(userId: number): ReadonlySet<string> {
  const { all, mine } = readSilencedScopes(userId)

  return new Set([...all, ...mine])
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

/**
 * Forgets every silence belonging to one source.
 *
 * For a source that is gone rather than merely quiet: its conditions can never fire again, so the
 * sweep that normally clears them, which runs against a read that answered, will never run. Not
 * folded into `forgetSource`: that also runs on an ordinary settings edit, where the alert is
 * still firing and the person who said they knew about it still does.
 * @param {number} connectorId - Source that has been removed
 * @returns {void}
 */
export function dropSilencesFor(connectorId: number): void {
  getDb()
    .prepare('DELETE FROM signal_silences WHERE signal_id LIKE ? || ?')
    .run(`${connectorId}:`, '%')
}

/**
 * Forgets every silence there is, for a configuration replaced wholesale.
 *
 * An import can swap the connectors outright, and an id is namespaced by a connector id that the
 * new file may have given to something else entirely.
 * @returns {void}
 */
export function dropAllSilences(): void {
  getDb().prepare('DELETE FROM signal_silences').run()
}
