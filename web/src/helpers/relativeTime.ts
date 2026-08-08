// Largest unit first, so the loop picks the coarsest one that still yields a value >= 1.
const UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60_000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60_000 },
  { unit: 'day', ms: 24 * 60 * 60_000 },
  { unit: 'hour', ms: 60 * 60_000 },
  { unit: 'minute', ms: 60_000 },
]

// `always` over `auto`, so the column reads "1d ago" rather than "yesterday" and every row
// keeps the same shape
const FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'narrow' })

/**
 * Formats an ISO timestamp as a short relative time, e.g. "3d ago".
 * @param {string} iso - ISO timestamp to describe
 * @param {Date} now - Instant to measure against
 * @returns {string | undefined} - Relative time, or undefined when the input is unparseable
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string | undefined {
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) {
    return undefined
  }

  const elapsed = timestamp - now.getTime()

  for (const { unit, ms } of UNITS) {
    if (Math.abs(elapsed) >= ms) {
      return FORMAT.format(Math.round(elapsed / ms), unit)
    }
  }

  return 'just now'
}
