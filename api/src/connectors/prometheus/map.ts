import type { HealthReading } from '#connectors/types.js'
import type { InstantPair, InstantResult, InstantSample } from './client.js'

/**
 * Reads the value out of an instant query's result, whichever shape it came in. A scalar carries
 * its `[unixSeconds, "value"]` pair directly, while a vector wraps one per sample.
 * @param {InstantResult} result - The `data` object of a successful query
 * @returns {string | undefined} - The value as Prometheus wrote it, or undefined when there is none
 */
function valueOf(result: InstantResult): string | undefined {
  if (!Array.isArray(result.result)) {
    return undefined
  }

  if (result.resultType === 'scalar') {
    return (result.result as InstantPair)[1]
  }

  const first = (result.result as ReadonlyArray<InstantSample>)[0]

  return first?.value?.[1]
}

/**
 * Turns an instant query's result into a reading.
 *
 * An empty result is nothing rather than `down`. `up{job="x"}` for a job that does not exist
 * returns no samples, and so does a query with a typo in a label: neither says the service is
 * failing, and drawing a red dot on that basis would report a mistake as an outage.
 *
 * A scalar answers the same way a vector does, so `count(...) > 0` and `up{...}` are both
 * expressible without anyone learning which shape this expects.
 * @param {InstantResult} result - The `data` object of a successful query
 * @returns {HealthReading | undefined} - The reading, or undefined when nothing matched
 */
export function readingOf(result: InstantResult): HealthReading | undefined {
  const raw = valueOf(result)
  if (raw === undefined) {
    return undefined
  }

  const value = Number(raw)
  if (Number.isNaN(value)) {
    return undefined
  }

  return { state: value === 0 ? 'down' : 'up', detail: `query returned ${raw}` }
}
