import type { Signal } from '#connectors/types.js'
import { signalFrom, type AlertMapping } from './signalRules.js'
import type { AlertRecord } from './client.js'

/**
 * Reads everything a Prometheus's own rules are firing, in the order the instance sent it. What
 * order they are shown in belongs to the document they are merged into, since two instances can
 * each be firing something and only that has both lists in front of it.
 *
 * These are the rules this instance evaluates and nothing else: an alert someone pushed straight
 * into an Alertmanager never appears here, and neither does the fact that one has been silenced.
 * Reading the Alertmanager instead is what `managedSignalsOf` is for.
 * @param {ReadonlyArray<AlertRecord>} alerts - Alerts as the v1 API sent them
 * @param {AlertMapping} mapping - Which instance these came from and what it reports
 * @returns {ReadonlyArray<Signal>} - Signals for the alerts that survived the filter
 */
export function signalsOf(
  alerts: ReadonlyArray<AlertRecord>,
  mapping: AlertMapping,
): ReadonlyArray<Signal> {
  return alerts.flatMap((alert) => {
    // `pending` is a rule whose condition has held for less than its `for` clause, which is
    // precisely the window its author asked not to be told about yet.
    if (alert.state !== 'firing') {
      return []
    }

    const signal = signalFrom({
      labels: alert.labels ?? {},
      annotations: alert.annotations ?? {},
      connectorId: mapping.connectorId,
      floor: mapping.floor,
      hideWatchdog: mapping.hideWatchdog,
      href: `${mapping.baseUrl}/alerts`,
      ...(alert.activeAt ? { since: alert.activeAt } : {}),
    })

    return signal ? [signal] : []
  })
}
