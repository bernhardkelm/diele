export interface Limiter {
  /**
   * Runs a job within the ceiling, or drops it when the queue is full.
   * @param {() => Promise<T>} job - Work to run
   * @param {number | undefined} timeoutMs - How long the caller waits for the answer, counted from the call
   * @returns {Promise<T | undefined>} - The answer, or undefined when dropped, failed or too late
   */
  run<T>(job: () => Promise<T>, timeoutMs?: number): Promise<T | undefined>
}

/**
 * Builds a ceiling on how many jobs run at once, with a bounded queue behind it that drops what
 * does not fit rather than growing with whatever is posted at it.
 *
 * The timeout runs from the call, so time spent queued counts: a job still waiting when it runs
 * out leaves the queue and never starts. A caller that stops waiting once a job has started gets
 * undefined, but the slot stays taken until the job itself settles, so jobs that hang cannot pile
 * up past the ceiling.
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
        let timer: ReturnType<typeof setTimeout> | undefined

        const start = (): void => {
          running += 1

          job()
            .then(resolve, () => resolve(undefined))
            .finally(() => {
              clearTimeout(timer)
              running -= 1
              startNext()
            })
        }

        if (timeoutMs !== undefined) {
          timer = setTimeout(() => {
            const queued = waiting.indexOf(start)
            if (queued >= 0) {
              waiting.splice(queued, 1)
            }

            resolve(undefined)
          }, timeoutMs)
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
