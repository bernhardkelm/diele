export interface Budget {
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

  return {
    take(owner: string, now: number = Date.now(), units: number = 1): boolean {
      for (const [key, entries] of spent) {
        const fresh = entries.filter((entry) => now - entry.at < windowMs)

        if (fresh.length === 0) {
          spent.delete(key)
        } else {
          spent.set(key, fresh)
        }
      }

      const entries = spent.get(owner) ?? []
      const used = entries.reduce((sum, entry) => sum + entry.units, 0)
      if (used + units > limit) {
        return false
      }

      spent.set(owner, [...entries, { at: now, units }])
      return true
    },
  }
}
