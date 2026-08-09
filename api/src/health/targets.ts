import { listEntries } from '#connectors/entries.js'
import { listLinks } from '#links/repository.js'

export interface HealthTarget {
  readonly ref: string
  readonly url: string
  readonly label: string
  /**
   * What the entry's own producer suggested a decorator match on, used when the binding names
   * no selector of its own. A repo carries its path here, which is what a monitor tends to be
   * named after.
   */
  readonly healthRef?: string
}

/**
 * Lists everything a binding can point at, keyed by ref. Only what the portal is currently
 * serving: a disabled card is not on the page, so probing it would spend a request on a dot
 * nobody can see, and a connector switched off takes its rows out of here with it.
 * @returns {ReadonlyMap<string, HealthTarget>} - Bindable entries by ref
 */
export function listTargets(): ReadonlyMap<string, HealthTarget> {
  const targets = new Map<string, HealthTarget>()

  for (const link of [...listLinks('card'), ...listLinks('site')]) {
    targets.set(link.ref, { ref: link.ref, url: link.url, label: link.label })
  }

  for (const entry of listEntries()) {
    targets.set(entry.ref, {
      ref: entry.ref,
      url: entry.url,
      label: entry.label,
      ...(entry.healthRef ? { healthRef: entry.healthRef } : {}),
    })
  }

  return targets
}
