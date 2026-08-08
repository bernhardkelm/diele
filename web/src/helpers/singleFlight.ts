export interface SingleFlight {
  (): Promise<void>
  /** Disowns a run in progress, so the next call starts a fresh one rather than joining it */
  reset: () => void
}

/**
 * Wraps a loader so concurrent callers share one run rather than each starting their own. Several
 * components asking for the same resource on a cold start is the ordinary case here, and without
 * this each mount would issue its own request for an answer the first one is already fetching.
 *
 * `reset` is what signing out needs: a load started for the previous session must not be handed
 * to the next caller, who is now someone else.
 * @param {() => Promise<void>} load - Loader to dedupe
 * @returns {SingleFlight} - Loader that runs at most once at a time
 */
export function singleFlight(load: () => Promise<void>): SingleFlight {
  let inFlight: Promise<void> | null = null

  const run = (): Promise<void> => {
    if (!inFlight) {
      // Cleared only when the run that set it is the one settling, so a run disowned by `reset`
      // cannot clear the run that replaced it.
      const started: Promise<void> = load().finally(() => {
        if (inFlight === started) {
          inFlight = null
        }
      })

      inFlight = started
    }

    return inFlight
  }

  run.reset = (): void => {
    inFlight = null
  }

  return run
}
