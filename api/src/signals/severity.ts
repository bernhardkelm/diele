import type { SignalSeverity } from '@diele/common'

/**
 * Which severity leads, and therefore which one outranks which. Not alphabetical by accident:
 * critical does come before warning.
 */
export const RANK: Readonly<Record<SignalSeverity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
}

/** What a source reports when nobody has said otherwise, which is what shipped before the choice existed. */
export const DEFAULT_FLOOR: SignalSeverity = 'warning'

/**
 * Returns whether a severity is loud enough for the floor a source was set to.
 *
 * The floor is the *least* severe level that still reaches the portal, so `warning` admits
 * warnings and criticals and turns away info.
 * @param {SignalSeverity} severity - How loud the alert says it is
 * @param {SignalSeverity} floor - Least severe level this source reports
 * @returns {boolean} - True when it should be shown
 */
export function meetsFloor(severity: SignalSeverity, floor: SignalSeverity): boolean {
  return RANK[severity] <= RANK[floor]
}
