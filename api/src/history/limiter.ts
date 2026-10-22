export interface Limiter {
  /**
   * Runs a job within the ceiling, or drops it when the queue is full.
   * @param {() => Promise<T>} job - Work to run
   * @param {number | undefined} timeoutMs - How long the caller waits for the answer
   * @returns {Promise<T | undefined>} - The answer, or undefined when dropped, failed or too late
   */
  run<T>(job: () => Promise<T>, timeoutMs?: number): Promise<T | undefined>
}

/**
 * Builds a ceiling on how many jobs run at once, with a bounded queue behind it that drops what
 * does not fit rather than growing with whatever is posted at it.
 *
 * A caller that stops waiting at its timeout gets undefined, but the slot stays taken until the
 * job itself settles. A name lookup cannot be cancelled once it is on libuv's thread pool, and
 * freeing the slot early would let lookups that hang pile up on the threads everything else uses.
 * @param {number} concurrency - Jobs running at once
 * @param {number} maxQueued - Jobs waiting; beyond this a new one is dropped
 * @returns {Limiter} - The limiter
 */
export function createLimiter(concurrency: number, maxQueued: number): Limiter {
  let running = 0
  const waiting: Array<() => void> = []

  const startNext = (): void => {
    if (running < concurrency) {
      waiting.shift()?.()
    }
  }

  return {
    run<T>(job: () => Promise<T>, timeoutMs?: number): Promise<T | undefined> {
      if (running >= concurrency && waiting.length >= maxQueued) {
        return Promise.resolve(undefined)
      }

      return new Promise<T | undefined>((resolve) => {
        const start = (): void => {
          running += 1

          const timer =
            timeoutMs === undefined ? undefined : setTimeout(() => resolve(undefined), timeoutMs)

          job()
            .then(resolve, () => resolve(undefined))
            .finally(() => {
              clearTimeout(timer)
              running -= 1
              startNext()
            })
        }

        if (running < concurrency) {
          start()
          return
        }

        waiting.push(start)
      })
    },
  }
}
