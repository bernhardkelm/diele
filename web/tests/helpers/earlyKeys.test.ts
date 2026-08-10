import { describe, expect, it } from 'vitest'
import { dropEarlyKeys, takeEarlyKeys } from '@/helpers/earlyKeys'

/**
 * Stands in for the inline capture in index.html, so the helper can be exercised without one.
 * @param {string} text - What the capture is to have collected
 * @returns {() => boolean} - Reads whether the capture has been ended
 */
function installCapture(text: string): () => boolean {
  let ended = false

  window.__dieleEarlyKeys = {
    end: () => {
      ended = true

      return text
    },
  }

  return () => ended
}

describe('what was typed before the app mounted', () => {
  it('hands the text over and ends the capture in the same step', () => {
    const hasEnded = installCapture('graf')

    expect(takeEarlyKeys()).toBe('graf')
    expect(hasEnded()).toBe(true)
  })

  // The script is inline in a document this module never sees; a build or a policy that drops it
  // must cost the replay and not the page.
  it('answers empty when no capture ever ran', () => {
    delete window.__dieleEarlyKeys

    expect(takeEarlyKeys()).toBe('')
  })

  it('gives the text to the first caller alone, so a later field cannot inherit it', () => {
    installCapture('graf')

    expect(takeEarlyKeys()).toBe('graf')
    expect(takeEarlyKeys()).toBe('')
  })

  // The login gate has no field to replay into, so a capture left running there would collect a
  // password and hand it to the launcher that mounts once the gate is gone.
  it('ends the capture when dropping it, leaving nothing to replay', () => {
    const hasEnded = installCapture('hunter2')

    dropEarlyKeys()

    expect(hasEnded()).toBe(true)
    expect(takeEarlyKeys()).toBe('')
  })
})
