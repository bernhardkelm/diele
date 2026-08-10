import type { HealthReading } from '#connectors/types.js'
import type { InstantPair, InstantResult, InstantSample } from './client.js'

/**
 * Reads every value out of an instant query's result, whichever shape it came in. A scalar carries
 * its `[unixSeconds, "value"]` pair directly, while a vector wraps one per sample.
 * @param {InstantResult} result - The `data` object of a successful query
 * @returns {ReadonlyArray<string>} - The values as Prometheus wrote them, in the order it sent them
 */
function valuesOf(result: InstantResult): ReadonlyArray<string> {
  if (!Array.isArray(result.result)) {
    return []
  }

  if (result.resultType === 'scalar') {
    const pair = result.result as InstantPair

    return pair[1] === undefined ? [] : [pair[1]]
  }

  const samples = result.result as ReadonlyArray<InstantSample>

  return samples.flatMap((sample) => (sample.value?.[1] === undefined ? [] : [sample.value[1]]))
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
 *
 * A vector carrying several series is read worst-first: `up{job="x"}` matches an instance apiece,
 * and one of them being down is the thing the dot exists to show.
 * @param {InstantResult} result - The `data` object of a successful query
 * @returns {HealthReading | undefined} - The reading, or undefined when nothing matched
 */
export function readingOf(result: InstantResult): HealthReading | undefined {
  // Prometheus puts a vector's samples in no particular order, so reading only the first reports
  // whichever series it happened to send first as though it spoke for the rest.
  const values = valuesOf(result).filter((value) => !Number.isNaN(Number(value)))
  if (values.length === 0) {
    return undefined
  }

  const down = values.filter((value) => Number(value) === 0)

  if (values.length === 1) {
    return { state: down.length === 0 ? 'up' : 'down', detail: `query returned ${values[0]}` }
  }

  return down.length > 0
    ? { state: 'down', detail: `${down.length} of ${values.length} series returned 0` }
    : { state: 'up', detail: `${values.length} series returned non-zero` }
}
