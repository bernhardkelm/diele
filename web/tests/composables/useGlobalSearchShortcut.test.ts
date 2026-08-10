import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalSearchShortcut } from '@/composables/useGlobalSearchShortcut'
import { withSetup } from '@tests/support/withSetup'

const focusAndSelect = vi.fn()
const focus = vi.fn()

/**
 * Mounts the shortcut and hands back the mounted host, so a test can take it down again.
 * @returns {ReturnType<typeof withSetup>} - The mounted host
 */
function listen() {
  return withSetup(() => useGlobalSearchShortcut({ focusAndSelect, focus }))
}

/**
 * Sends a key press, optionally from a control that takes typing itself.
 * @param {string} key - Key name
 * @param {object} options - Where it came from and which modifiers were held
 * @returns {KeyboardEvent} - The dispatched event
 */
function press(
  key: string,
  options: { from?: HTMLElement; init?: KeyboardEventInit } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    cancelable: true,
    bubbles: true,
    ...options.init,
  })
  ;(options.from ?? window).dispatchEvent(event)

  return event
}

beforeEach(() => {
  focusAndSelect.mockClear()
  focus.mockClear()
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the slash shortcut', () => {
  it('jumps to the field from anywhere on the page', () => {
    listen()

    expect(press('/').defaultPrevented).toBe(true)
    expect(focusAndSelect).toHaveBeenCalled()
  })

  // A control that takes typing keeps the key, including a select, where `/` jumps to the
  // option starting with it.
  it('leaves the key to a control that takes typing', () => {
    listen()

    for (const tag of ['input', 'select', 'textarea']) {
      const control = document.createElement(tag)
      document.body.append(control)

      expect(press('/', { from: control }).defaultPrevented, tag).toBe(false)
    }

    expect(focusAndSelect).not.toHaveBeenCalled()
  })

  it('ignores a slash pressed as part of a chord', () => {
    listen()

    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      press('/', { init })
    }

    expect(focusAndSelect).not.toHaveBeenCalled()
  })
})

// Tab or Enter into a page that holds no focus means "start here", and the field is where the
// portal starts.
describe('typing into a page that holds no focus', () => {
  it('takes tab and enter to the field', () => {
    listen()

    expect(press('Tab').defaultPrevented).toBe(true)
    expect(press('Enter').defaultPrevented).toBe(true)
    expect(focusAndSelect).toHaveBeenCalledTimes(2)
  })

  // Shift-tab means "go back", which is the one direction the field is not.
  it('leaves shift-tab alone', () => {
    listen()

    expect(press('Tab', { init: { shiftKey: true } }).defaultPrevented).toBe(false)
  })

  it('leaves both alone once something on the page holds focus', () => {
    listen()
    const control = document.createElement('input')
    document.body.append(control)
    control.focus()

    press('Tab', { from: control })
    press('Enter', { from: control })

    expect(focusAndSelect).not.toHaveBeenCalled()
  })
})

it('stops listening once the view is gone', () => {
  const { wrapper } = listen()
  wrapper.unmount()

  press('/')

  expect(focusAndSelect).not.toHaveBeenCalled()
})
