import { readonly, ref, type Ref } from 'vue'

// Shared at module scope the way the session is: every read of the api reports into this one
// flag, and the portal says so once however many documents found the session gone. A file of
// its own rather than part of useSession, because useSession imports the composables that report
// here and importing it back from them would make the two modules a cycle.
const lapsed = ref(false)

/** Whether the session this page was opened under has ended, while what it painted stays up. */
export const sessionLapsed: Readonly<Ref<boolean>> = readonly(lapsed)

/**
 * Records a lapse when a response says the session is gone. Only a 401 says that: a 403 is a
 * signed-in account refused something, or a write turned away for its origin, and signing in
 * again would fix neither.
 * @param {number} status - Status the api answered with
 * @returns {boolean} - True when the status was a lapse and has been recorded
 */
export function reportLapse(status: number): boolean {
  if (status !== 401) {
    return false
  }

  lapsed.value = true

  return true
}

/**
 * Lets go of a recorded lapse, once the session has been read back as live.
 * @returns {void}
 */
export function clearLapse(): void {
  lapsed.value = false
}
