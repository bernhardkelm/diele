import { afterEach, describe, expect, it } from 'vitest'
import { useStickyFocus, type StickyFocusOptions } from '@/composables/useStickyFocus'
import { withSetup } from '@tests/support/withSetup'

const OPTIONS: StickyFocusOptions = { selector: '[data-station]', heldClass: 'row-marker-held' }

/**
 * Builds a focusable row of the kind the list is made of.
 * @returns {HTMLElement} - The row, already in the document
 */
function row(): HTMLElement {
  const element = document.createElement('li')
  element.setAttribute('data-station', 'entry:1')
  element.tabIndex = 0
  document.body.append(element)

  return element
}

/**
 * Plays a press that takes the caret nowhere, the way a click on the page background does.
 * @param {HTMLElement} losing - Element the press takes the caret off
 * @param {EventTarget | null} landing - What takes the caret instead, null when nothing does
 * @returns {void}
 */
function press(losing: HTMLElement, landing: EventTarget | null = null): void {
  document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  losing.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: landing }))
  losing.blur()
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useStickyFocus', () => {
  it('puts the caret back on the row a press took it off', () => {
    withSetup(() => useStickyFocus(OPTIONS))
    const element = row()
    element.focus()

    press(element)

    expect(document.activeElement).toBe(element)
  })

  // The marker is drawn by `:focus`, so a press held long enough to select text would unmark
  // the row it is about to hand the caret straight back to.
  it('keeps the row marked for the length of the press', () => {
    withSetup(() => useStickyFocus(OPTIONS))
    const element = row()
    element.focus()

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    element.blur()
    expect(element.classList.contains(OPTIONS.heldClass)).toBe(true)

    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))

    // handed back to `:focus`, which draws it from here on
    expect(element.classList.contains(OPTIONS.heldClass)).toBe(false)
    expect(document.activeElement).toBe(element)
  })

  // Anything that can hold the caret taking it is a move to honour rather than one to undo.
  it('leaves the caret with whatever took it', () => {
    withSetup(() => useStickyFocus(OPTIONS))
    const element = row()
    const field = document.createElement('input')
    document.body.append(field)
    element.focus()

    press(element, field)
    field.focus()

    expect(document.activeElement).toBe(field)
  })

  // A caret the page moved itself is not one a press dropped, so there is nothing to put back.
  it('leaves a caret no press was behind alone', () => {
    withSetup(() => useStickyFocus(OPTIONS))
    const element = row()
    element.focus()

    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    element.blur()
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))

    expect(document.activeElement).not.toBe(element)
  })

  // A row the write removed has nothing to go back to.
  it('drops a row that left the list before the press ended', () => {
    withSetup(() => useStickyFocus(OPTIONS))
    const element = row()
    element.focus()

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    element.blur()
    element.remove()

    expect(() =>
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })),
    ).not.toThrow()
    expect(document.activeElement).toBe(document.body)
  })

  // A press that ends outside the window never reports up, and would otherwise leave the row
  // waiting to be restored by whatever press comes next.
  it('forgets a press the window lost', () => {
    withSetup(() => useStickyFocus(OPTIONS))
    const element = row()
    element.focus()

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    element.blur()
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))

    expect(document.activeElement).toBe(document.body)
  })

  it('stops listening once the view is gone', () => {
    const { wrapper } = withSetup(() => useStickyFocus(OPTIONS))
    const element = row()
    element.focus()
    wrapper.unmount()

    press(element)

    expect(document.activeElement).toBe(document.body)
  })
})
