import type { LaunchAction, PortalTarget } from '@/types/portal'

/**
 * Returns every action reachable on a target, the default one first. A target that names none
 * offers only its own url, so the arrow keys have nothing to switch between on one; a repo
 * arrives carrying its pipelines, merge requests and releases already expanded, which is what
 * lets a second forge ship without a line of this file changing.
 * @param {PortalTarget} target - Target to describe
 * @returns {ReadonlyArray<LaunchAction>} - Actions, default first
 */
export function actionsFor(target: PortalTarget): ReadonlyArray<LaunchAction> {
  return target.actions?.length
    ? target.actions
    : [{ label: '', title: target.name, href: target.url }]
}
