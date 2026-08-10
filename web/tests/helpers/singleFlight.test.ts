import { describe, expect, it, vi } from 'vitest'
import { singleFlight } from '@/helpers/singleFlight'

/**
 * Builds a loader whose settling the test controls.
 * @returns {{ load: () => Promise<void>; calls: () => number; settle: () => void; fail: (error: Error) => void }} - The loader and its controls
 */
function deferred(): {
  load: () => Promise<void>
  calls: () => number
  settle: () => void
  fail: (error: Error) => void
} {
  let resolve: () => void = () => {}
  let reject: (error: Error) => void = () => {}
  let calls = 0

  return {
    load: () => {
      calls += 1
      return new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
    },
    calls: () => calls,
    settle: () => resolve(),
    fail: (error: Error) => reject(error),
  }
}

describe('singleFlight', () => {
  // Several components asking for the same resource on a cold start is the ordinary case, and
  // without this each mount would issue its own request for an answer one of them is fetching.
  it('hands concurrent callers the same run', async () => {
    const { load, calls, settle } = deferred()
    const run = singleFlight(load)

    const first = run()
    const second = run()

    expect(calls()).toBe(1)
    expect(second).toBe(first)

    settle()
    await Promise.all([first, second])
  })

  it('starts a fresh run once the previous one has settled', async () => {
    const { load, calls, settle } = deferred()
    const run = singleFlight(load)

    const first = run()
    settle()
    await first

    void run()
    expect(calls()).toBe(2)
  })

  it('clears itself after a failure, so a retry is not stuck on the rejected run', async () => {
    const { load, calls, fail } = deferred()
    const run = singleFlight(load)

    const first = run()
    fail(new Error('offline'))
    await expect(first).rejects.toThrow('offline')

    void run()
    expect(calls()).toBe(2)
  })

  // What signing out needs: a load started for the previous session must not be handed to the
  // next caller, who is now someone else.
  it('disowns a run in progress on reset', async () => {
    const { load, calls, settle } = deferred()
    const run = singleFlight(load)

    const disowned = run()
    run.reset()

    const fresh = run()
    expect(calls()).toBe(2)
    expect(fresh).not.toBe(disowned)

    settle()
  })

  // The bug this guards: a disowned run settling later must not clear the run that replaced it,
  // which would leave the next caller starting a third.
  it('a disowned run settling does not clear the run that replaced it', async () => {
    let settleFirst: () => void = () => {}
    let settleSecond: () => void = () => {}
    let calls = 0

    const run = singleFlight(() => {
      calls += 1
      return new Promise<void>((resolve) => {
        if (calls === 1) {
          settleFirst = resolve
        } else {
          settleSecond = resolve
        }
      })
    })

    const disowned = run()
    run.reset()
    const replacement = run()

    // The first run finishes after it was disowned.
    settleFirst()
    await disowned

    expect(run()).toBe(replacement)
    expect(calls).toBe(2)

    settleSecond()
    await replacement
  })

  it('resetting when nothing is running is not an error', () => {
    const run = singleFlight(() => Promise.resolve())

    expect(() => run.reset()).not.toThrow()
  })

  it('calls the loader lazily rather than on construction', () => {
    const load = vi.fn(() => Promise.resolve())
    singleFlight(load)

    expect(load).not.toHaveBeenCalled()
  })
})
