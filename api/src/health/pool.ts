/**
 * Runs an async mapper over a list with a ceiling on how many are in flight. Health resolution
 * fans out one request per bound entry for the providers that cannot batch, and a portal with
 * thirty cards should not open thirty sockets at once against a homelab box.
 *
 * A rejection becomes `undefined` in that slot rather than failing the batch, so one unreachable
 * target costs its own dot and nobody else's.
 * @param {ReadonlyArray<T>} items - What to map over
 * @param {number} limit - How many may run at once, at least one
 * @param {(item: T, index: number) => Promise<R>} run - The mapper
 * @returns {Promise<Array<R | undefined>>} - Results in the order of the input
 */
export async function mapLimit<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<Array<R | undefined>> {
  const results = Array.from<R | undefined>({ length: items.length })
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1

      try {
        results[index] = await run(items[index] as T, index)
      } catch {
        results[index] = undefined
      }
    }
  }

  const width = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: width }, () => worker()))

  return results
}
