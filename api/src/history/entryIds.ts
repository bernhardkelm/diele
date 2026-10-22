import { randomInt } from 'node:crypto'

/** Tries at a fresh id before an insert gives up; a second collision below 2^53 is not expected. */
const ID_ATTEMPTS = 3

const HIGH_BITS = 2 ** 21
const LOW_BITS = 2 ** 32

/**
 * Draws an entry id: a random positive integer below 2^53, so it stays a safe JSON number. A
 * running counter would tell every account how many entries the whole instance has created.
 * @returns {number} - The id
 */
export function randomEntryId(): number {
  const id = randomInt(0, HIGH_BITS) * LOW_BITS + randomInt(0, LOW_BITS)

  return id === 0 ? randomEntryId() : id
}

/**
 * Returns whether a failed insert failed on the id alone, which another draw fixes.
 * @param {unknown} error - What the insert threw
 * @returns {boolean} - True for a primary key collision
 */
function isIdCollision(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
}

/**
 * Runs an insert with a freshly drawn id, drawing again on the unlikely collision.
 * @param {(id: number) => T} insert - The insert, given the id to use
 * @returns {T} - What the insert answered
 */
export function withFreshId<T>(insert: (id: number) => T): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return insert(randomEntryId())
    } catch (error) {
      if (attempt >= ID_ATTEMPTS || !isIdCollision(error)) {
        throw error
      }
    }
  }
}
