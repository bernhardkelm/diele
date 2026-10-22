export interface Budget {
  /**
   * Takes one unit from an account's budget.
   * @param {string} owner - The account's history key
   * @param {number} now - Current time, in ms since the epoch
   * @returns {boolean} - True when the account had one left
   */
  take(owner: string, now?: number): boolean
}

/**
 * Builds a per-account allowance over a sliding window.
 * @param {number} limit - Units one account may take per window
 * @param {number} windowMs - Length of the window, in ms
 * @returns {Budget} - The budget
 */
export function createBudget(limit: number, windowMs: number): Budget {
  // When each account's recent units were taken, oldest first.
  const spent = new Map<string, number[]>()

  return {
    take(owner: string, now: number = Date.now()): boolean {
      for (const [key, stamps] of spent) {
        const fresh = stamps.filter((stamp) => now - stamp < windowMs)

        if (fresh.length === 0) {
          spent.delete(key)
        } else {
          spent.set(key, fresh)
        }
      }

      const stamps = spent.get(owner) ?? []
      if (stamps.length >= limit) {
        return false
      }

      spent.set(owner, [...stamps, now])
      return true
    },
  }
}
