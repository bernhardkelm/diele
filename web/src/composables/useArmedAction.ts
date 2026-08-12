import { computed, ref, type ComputedRef } from 'vue'

/** A press that has to be repeated before it counts. */
export interface ArmedAction {
  /** Whether the next press carries the action out rather than asking again */
  armed: ComputedRef<boolean>
  /** Arms on the first press, runs the action on the second and passes its result back */
  press: <T>(action: () => T) => T | undefined
  /** Forgets a pending press, so the next one asks again */
  disarm: () => void
  /** Forgets a pending press once focus leaves the element this is bound to */
  onFocusout: (event: FocusEvent) => void
}

/**
 * Guards an action that has nothing to undo it by asking for it twice. Disarms before the action
 * runs rather than after, so a press that fails or throws leaves nothing armed behind it.
 * @returns {ArmedAction} - The armed state and the presses that drive it
 */
export function useArmedAction(): ArmedAction {
  const pending = ref(false)

  /**
   * Arms the action on the first press and carries it out on the second.
   * @param {() => T} action - What the second press runs
   * @returns {T | undefined} - What the action returned, or undefined on the press that armed it
   */
  function press<T>(action: () => T): T | undefined {
    if (!pending.value) {
      pending.value = true

      return undefined
    }

    pending.value = false

    return action()
  }

  /**
   * Forgets a pending press.
   * @returns {void}
   */
  function disarm(): void {
    pending.value = false
  }

  /**
   * Disarms once focus leaves the element the handler is bound to, so a pending press cannot be
   * completed later by a keystroke or a click aimed at something else.
   * @param {FocusEvent} event - Focus leaving the element or something inside it
   * @returns {void}
   */
  function onFocusout(event: FocusEvent): void {
    const next = event.relatedTarget
    const container = event.currentTarget as HTMLElement

    if (next instanceof Node && container.contains(next)) {
      return
    }

    pending.value = false
  }

  return { armed: computed(() => pending.value), press, disarm, onFocusout }
}
