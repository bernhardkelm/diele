import { ref, type Ref } from 'vue'
import { rowActionsFor } from '@/features/admin/adminRowActions'
import type { AdminStation } from '@/features/admin/adminStations'
import { walkDelta } from '@/helpers/walkDelta'

export interface AdminKeyboardOptions {
  /** Row the ring currently sits on */
  active: () => AdminStation | undefined
  /** Steps the ring by one row */
  step: (delta: number) => void
  /** Hands focus back to the search field */
  leave: () => void
}

export interface AdminKeyboard {
  /** Action the left and right keys selected on the focused row, 0 being the row itself */
  activeAction: Ref<number>
  walkDelta: (event: KeyboardEvent, inSearch: boolean) => number
  openPicker: (select: HTMLSelectElement) => void
  stepInForm: (form: HTMLElement, from: HTMLElement, delta: number) => void
  moveAction: (delta: number) => void
}

/**
 * The panel's movement rules: what counts as a step, how a step crosses an open form, and how
 * the left and right keys walk a row's actions.
 *
 * Separate from the view because none of it renders anything: it reads the DOM the list
 * produced and decides where the caret goes next.
 * @param {AdminKeyboardOptions} options - The ring's current row and how to move it
 * @returns {AdminKeyboard} - The action cursor and the walking rules
 */
export function useAdminKeyboard(options: AdminKeyboardOptions): AdminKeyboard {
  const activeAction = ref(0)

  /**
   * Opens a dropdown, where the browser allows it to be asked for.
   * @param {HTMLSelectElement} select - Dropdown to open
   * @returns {void}
   */
  function openPicker(select: HTMLSelectElement): void {
    if (typeof select.showPicker === 'function') {
      select.showPicker()
    }
  }

  /**
   * Steps between the controls of an open form, and out of it at either end: forwards past the
   * last control carries on to the row below, back past the first returns to the row the form
   * belongs to.
   * @param {HTMLElement} form - The open form
   * @param {HTMLElement} from - Control the step is leaving
   * @param {number} delta - 1 forwards, -1 back
   * @returns {void}
   */
  function stepInForm(form: HTMLElement, from: HTMLElement, delta: number): void {
    const controls = [...form.querySelectorAll<HTMLElement>('input, select, textarea, button')]
      // the file picker behind the upload button is never on screen to be stepped onto
      .filter((control) => control.offsetParent !== null)

    // A control the walk does not know about, such as the label a click landed on, has no place
    // to step from. Without this its index reads as -1 and a step forwards lands on the first
    // control, which is the form refusing to be left in the one direction it should be.
    const index = controls.indexOf(from)
    const landing = index >= 0 ? controls[index + delta] : undefined

    if (landing) {
      landing.focus()
      return
    }

    const row = from.closest<HTMLElement>('[data-station]')

    if (!row) {
      options.leave()
      return
    }

    row.focus()

    // going back, the row above the form is the thing being stepped onto; going on, it is only
    // passed through on the way to whatever follows it
    if (delta > 0) {
      options.step(1)
    }
  }

  /**
   * Walks the focused row's actions, wrapping the way the repo rows do and stepping over the
   * ones that would do nothing, so moving the first row up is never something to land on.
   * @param {number} delta - Actions to move by, negative to move left
   * @returns {void}
   */
  function moveAction(delta: number): void {
    const list = rowActionsFor(options.active())
    const count = list.length
    if (count <= 1) {
      return
    }

    // one lap at most; index 0 is the row itself and is never disabled, so this always lands
    let next = activeAction.value

    for (let taken = 0; taken < count; taken += 1) {
      next = (next + delta + count) % count

      if (!list[next]?.disabled) {
        activeAction.value = next
        return
      }
    }
  }

  return { activeAction, walkDelta, openPicker, stepInForm, moveAction }
}
