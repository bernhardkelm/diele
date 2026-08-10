import { describe, expect, it } from 'vitest'
import { walkDelta } from '@/helpers/walkDelta'

/**
 * Builds the key press the helper reads.
 * @param {string} key - Key name
 * @param {boolean} shiftKey - Whether shift was held
 * @returns {KeyboardEvent} - The event
 */
function press(key: string, shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, shiftKey })
}

describe('walkDelta', () => {
  it('steps forward and back on the arrows, in the field or out of it', () => {
    for (const inSearch of [true, false]) {
      expect(walkDelta(press('ArrowDown'), inSearch)).toBe(1)
      expect(walkDelta(press('ArrowUp'), inSearch)).toBe(-1)
    }
  })

  // One order rather than two: tab moves the same way the arrows do.
  it('steps on tab outside the search field', () => {
    expect(walkDelta(press('Tab'), false)).toBe(1)
    expect(walkDelta(press('Tab', true), false)).toBe(-1)
  })

  // In a text box, tab is how the caret gets out in the first place.
  it('leaves tab alone inside the search field', () => {
    expect(walkDelta(press('Tab'), true)).toBe(0)
    expect(walkDelta(press('Tab', true), true)).toBe(0)
  })

  it('reads anything else as no step', () => {
    for (const key of ['Enter', 'Escape', 'a', ' ', 'ArrowLeft', 'ArrowRight']) {
      expect(walkDelta(press(key), false), key).toBe(0)
      expect(walkDelta(press(key), true), key).toBe(0)
    }
  })

  it('ignores shift on the arrows', () => {
    expect(walkDelta(press('ArrowDown', true), false)).toBe(1)
    expect(walkDelta(press('ArrowUp', true), false)).toBe(-1)
  })
})
