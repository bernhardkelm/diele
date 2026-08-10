import { defineComponent, type VNode } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

export interface Mounted<T> {
  /** What the composable returned, captured during setup */
  readonly result: T
  /** The host component, so a test can unmount it and watch the teardown run */
  readonly wrapper: VueWrapper
}

/**
 * Runs a composable inside a real component, which is what `onMounted` and `onBeforeUnmount`
 * need to fire at all. Calling one at the top of a test would leave both hooks unregistered
 * and the teardown untested.
 * @param {() => T} composable - Composable call to run in setup
 * @returns {Mounted<T>} - What it returned, and the component holding it
 */
export function withSetup<T>(composable: () => T): Mounted<T> {
  let result!: T

  const wrapper = mount(
    defineComponent({
      setup() {
        result = composable()
        return (): VNode | null => null
      },
    }),
    { attachTo: document.body },
  )

  return { result, wrapper }
}
