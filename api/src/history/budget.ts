export interface Budget {
  /**
   * Returns whether an account has units left, taking none.
   * @param {string} owner - The account's history key, or what an instance-wide budget is filed under
   * @param {number} now - Current time, in ms since the epoch
   * @param {number} units - How many it would take
   * @returns {boolean} - True when that many are left
   */
  has(owner: string, now?: number, units?: number): boolean
  /**
   * Takes units from an account's budget, all of them or none.
   * @param {string} owner - The account's history key, or what an instance-wide budget is filed under
   * @param {number} now - Current time, in ms since the epoch
   * @param {number} units - How many to take
   * @returns {boolean} - True when the account had that many left
   */
  take(owner: string, now?: number, units?: number): boolean
}

interface Spent {
  readonly at: number
  readonly units: number
}

/**
 * Builds a per-account allowance over a sliding window.
 * @param {number} limit - Units one account may take per window
 * @param {number} windowMs - Length of the window, in ms
 * @returns {Budget} - The budget
 */
export function createBudget(limit: number, windowMs: number): Budget {
  // What each account took recently, oldest first.
  const spent = new Map<string, Spent[]>()

  /**
   * Forgets what fell out of the window, for every account, and reads what one has left.
   * @param {string} owner - Account to read
   * @param {number} now - Current time, in ms since the epoch
   * @returns {number} - Units still free for it
   */
  const left = (owner: string, now: number): number => {
    for (const [key, entries] of spent) {
      const fresh = entries.filter((entry) => now - entry.at < windowMs)

      if (fresh.length === 0) {
        spent.delete(key)
      } else {
        spent.set(key, fresh)
      }
    }

    return limit - (spent.get(owner) ?? []).reduce((sum, entry) => sum + entry.units, 0)
  }

  return {
    has(owner: string, now: number = Date.now(), units: number = 1): boolean {
      return left(owner, now) >= units
    },

    take(owner: string, now: number = Date.now(), units: number = 1): boolean {
      if (left(owner, now) < units) {
        return false
      }

      spent.set(owner, [...(spent.get(owner) ?? []), { at: now, units }])
      return true
    },
  }
}
