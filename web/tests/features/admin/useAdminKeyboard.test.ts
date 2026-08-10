import { afterEach, describe, expect, it, vi } from 'vitest'
import { rowActionsFor } from '@/features/admin/adminRowActions'
import { useAdminKeyboard, type AdminKeyboardOptions } from '@/features/admin/useAdminKeyboard'
import type { AdminStation } from '@/features/admin/adminStations'

/**
 * Builds an entry station, which is the row that carries the full set of actions.
 * @param {Partial<{ first: boolean; last: boolean; enabled: boolean }>} overrides - Where the row sits and how it stands
 * @returns {AdminStation} - The station
 */
function entryStation(overrides: { first?: boolean; last?: boolean; enabled?: boolean } = {}) {
  return {
    kind: 'entry',
    key: 'entry:1',
    label: 'Grafana',
    first: overrides.first ?? false,
    last: overrides.last ?? false,
    row: { id: 1, enabled: overrides.enabled ?? true, readonly: false },
    feature: { id: 'links', capabilities: [] },
  } as unknown as AdminStation
}

/**
 * Builds the composable with spies for the movements it asks the view to make.
 * @param {AdminStation | undefined} active - Row the ring sits on
 * @returns {object} - The keyboard plus the spies it drives
 */
function keyboard(active: AdminStation | undefined) {
  const step = vi.fn()
  const leave = vi.fn()
  const options: AdminKeyboardOptions = { active: () => active, step, leave }

  return { board: useAdminKeyboard(options), step, leave }
}

/**
 * Builds an open form with the controls a step walks through.
 * @param {number} count - How many visible controls it holds
 * @returns {{ form: HTMLElement; controls: HTMLElement[] }} - The form and its controls
 */
function openForm(count: number): { form: HTMLElement; controls: HTMLElement[] } {
  const row = document.createElement('div')
  row.setAttribute('data-station', 'entry:1')
  row.tabIndex = -1

  const form = document.createElement('div')
  const controls: HTMLElement[] = []

  for (let index = 0; index < count; index += 1) {
    const input = document.createElement('input')
    // jsdom lays nothing out, so `offsetParent` is null for everything; the filter the composable
    // applies is about a hidden file picker, and this stands in for being on screen.
    Object.defineProperty(input, 'offsetParent', { configurable: true, value: form })
    form.append(input)
    controls.push(input)
  }

  row.append(form)
  document.body.append(row)

  return { form, controls }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('reading a key as a step', () => {
  it('walks with the arrows in either direction', () => {
    const { board } = keyboard(entryStation())

    expect(board.walkDelta(new KeyboardEvent('keydown', { key: 'ArrowDown' }), false)).toBe(1)
    expect(board.walkDelta(new KeyboardEvent('keydown', { key: 'ArrowUp' }), false)).toBe(-1)
  })

  // One order rather than two: Tab walks the list the same way the arrows do.
  it('treats Tab as a step once the caret has left the search field', () => {
    const { board } = keyboard(entryStation())
    const tab = new KeyboardEvent('keydown', { key: 'Tab' })
    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true })

    expect(board.walkDelta(tab, false)).toBe(1)
    expect(board.walkDelta(shiftTab, false)).toBe(-1)
  })

  // In a text box Tab is how the caret gets out in the first place, so it is left alone.
  it('leaves Tab alone in the search field', () => {
    const { board } = keyboard(entryStation())

    expect(board.walkDelta(new KeyboardEvent('keydown', { key: 'Tab' }), true)).toBe(0)
  })

  it('reads anything else as no step at all', () => {
    const { board } = keyboard(entryStation())

    for (const key of ['Enter', 'Escape', 'a', ' ']) {
      expect(board.walkDelta(new KeyboardEvent('keydown', { key }), false), key).toBe(0)
    }
  })
})

describe('stepping through an open form', () => {
  it('moves to the next control and the previous one', () => {
    const { board } = keyboard(entryStation())
    const { form, controls } = openForm(3)

    board.stepInForm(form, controls[1]!, 1)
    expect(document.activeElement).toBe(controls[2])

    board.stepInForm(form, controls[1]!, -1)
    expect(document.activeElement).toBe(controls[0])
  })

  // Back past the first control returns to the row the form belongs to, and stays there.
  it('returns to the row it belongs to when stepping back off the first control', () => {
    const { board, step } = keyboard(entryStation())
    const { form, controls } = openForm(2)

    board.stepInForm(form, controls[0]!, -1)

    expect((document.activeElement as HTMLElement).dataset.station).toBe('entry:1')
    expect(step).not.toHaveBeenCalled()
  })

  // Forwards, the row is only passed through on the way to whatever follows it.
  it('carries on past the row when stepping forwards off the last control', () => {
    const { board, step } = keyboard(entryStation())
    const { form, controls } = openForm(2)

    board.stepInForm(form, controls[1]!, 1)

    expect(step).toHaveBeenCalledWith(1)
  })

  // Without this its index reads as -1 and a step forwards lands on the first control, which is
  // the form refusing to be left in the one direction it should be.
  it('leaves the form when the step starts from something it does not know', () => {
    const { board, step } = keyboard(entryStation())
    const { form } = openForm(2)
    const label = document.createElement('label')
    form.append(label)

    board.stepInForm(form, label, 1)

    expect(step).toHaveBeenCalledWith(1)
  })

  it('hands focus back to the field when the form belongs to no row', () => {
    const { board, leave } = keyboard(entryStation())
    const orphan = document.createElement('div')
    const control = document.createElement('input')
    Object.defineProperty(control, 'offsetParent', { configurable: true, value: orphan })
    orphan.append(control)
    document.body.append(orphan)

    board.stepInForm(orphan, control, -1)

    expect(leave).toHaveBeenCalled()
  })
})

describe('stepping into an open form', () => {
  // The walk out of a form leaves it open, so it has to be reversible: entering at the end the
  // step arrives from is what makes crossing the form read the same in both directions.
  it('enters at the first control coming down and the last coming up', () => {
    const { board } = keyboard(entryStation())
    const { form, controls } = openForm(3)

    expect(board.enterForm(form, 1)).toBe(true)
    expect(document.activeElement).toBe(controls[0])

    expect(board.enterForm(form, -1)).toBe(true)
    expect(document.activeElement).toBe(controls[2])
  })

  // Said rather than assumed, so the caller can fall back to a plain step instead of swallowing
  // the key on a form with nowhere to put the caret.
  it('refuses a form holding nothing to land on', () => {
    const { board } = keyboard(entryStation())
    const { form } = openForm(0)

    expect(board.enterForm(form, 1)).toBe(false)
    expect(board.enterForm(form, -1)).toBe(false)
  })
})

describe('walking a row actions', () => {
  it('moves right and wraps back round to the row itself', () => {
    const { board } = keyboard(entryStation())
    const count = rowActionsFor(entryStation()).length

    for (let taken = 1; taken < count; taken += 1) {
      board.moveAction(1)
      expect(board.activeAction.value).toBe(taken)
    }

    board.moveAction(1)
    expect(board.activeAction.value).toBe(0)
  })

  it('moves left from the row onto the last action', () => {
    const { board } = keyboard(entryStation())
    const count = rowActionsFor(entryStation()).length

    board.moveAction(-1)

    expect(board.activeAction.value).toBe(count - 1)
  })

  // Moving the first row up would do nothing, so it is never something to land on.
  it('steps over an action that would do nothing', () => {
    const { board } = keyboard(entryStation({ first: true }))
    const actions = rowActionsFor(entryStation({ first: true }))

    board.moveAction(1)

    expect(actions[board.activeAction.value]?.disabled).not.toBe(true)
    expect(actions[board.activeAction.value]?.id).toBe('down')
  })

  it('stays put on a row that offers nothing to walk', () => {
    const readonlyRow = {
      ...(entryStation() as unknown as Record<string, unknown>),
      row: { id: 1, enabled: true, readonly: true },
    } as unknown as AdminStation
    const { board } = keyboard(readonlyRow)

    board.moveAction(1)

    expect(board.activeAction.value).toBe(0)
  })

  it('stays put when there is no row at all', () => {
    const { board } = keyboard(undefined)

    board.moveAction(1)

    expect(board.activeAction.value).toBe(0)
  })
})

describe('opening a dropdown', () => {
  it('asks the browser to open it where that is allowed', () => {
    const { board } = keyboard(entryStation())
    const select = document.createElement('select')
    const showPicker = vi.fn()
    Object.defineProperty(select, 'showPicker', { configurable: true, value: showPicker })

    board.openPicker(select)

    expect(showPicker).toHaveBeenCalled()
  })

  // Not every browser offers it, and asking anyway would throw where it does not.
  it('does nothing where the browser does not offer it', () => {
    const { board } = keyboard(entryStation())
    const select = document.createElement('select')
    Object.defineProperty(select, 'showPicker', { configurable: true, value: undefined })

    expect(() => board.openPicker(select)).not.toThrow()
  })
})
