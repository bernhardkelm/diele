import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBudget } from '#history/budget.js'
import { createLimiter } from '#history/limiter.js'

/**
 * Lets the event loop run the callbacks a settled promise queued.
 * @returns {Promise<void>}
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Builds jobs that stay pending until released, newest last.
 * @returns {{ job: () => Promise<boolean>; release: () => void; started: () => number }} - The job and its controls
 */
function gate(): { job: () => Promise<boolean>; release: () => void; started: () => number } {
  const releases: Array<() => void> = []

  return {
    job: () =>
      new Promise<boolean>((resolve) => {
        releases.push(() => resolve(true))
      }),
    release: () => {
      releases.shift()?.()
    },
    started: () => releases.length,
  }
}

test('one account runs out of its budget for the window, another does not', () => {
  const budget = createBudget(3, 60_000)
  const now = Date.now()

  assert.equal(budget.take('busy', now), true)
  assert.equal(budget.take('busy', now), true)
  assert.equal(budget.take('busy', now), true)
  assert.equal(budget.take('busy', now), false)
  assert.equal(budget.take('quiet', now), true)
  assert.equal(budget.take('busy', now + 61_000), true)
})

test('no more than the ceiling run at once, and past the queue a job is dropped', async () => {
  const limiter = createLimiter(2, 3)
  const { job, release, started } = gate()

  const accepted = Array.from({ length: 5 }, () => limiter.run(job))
  assert.equal(started(), 2)
  assert.equal(await limiter.run(job), undefined)

  for (let index = 0; index < 5; index += 1) {
    release()
    await tick()
  }

  assert.ok((await Promise.all(accepted)).every((answer) => answer === true))
})

// A lookup cannot be cancelled once it is on the thread pool, so the slot is held until it ends.
test('a caller that times out gets nothing, and the slot stays taken until the job ends', async () => {
  const limiter = createLimiter(1, 0)
  const { job, release, started } = gate()

  assert.equal(await limiter.run(job, 10), undefined)
  assert.equal(started(), 1)
  assert.equal(await limiter.run(job), undefined)

  release()
  await tick()

  const next = limiter.run(job)
  assert.equal(started(), 1)
  release()
  assert.equal(await next, true)
})

test('a job that fails answers nothing rather than throwing', async () => {
  const limiter = createLimiter(1, 1)

  assert.equal(await limiter.run(async () => Promise.reject(new Error('boom'))), undefined)
})
