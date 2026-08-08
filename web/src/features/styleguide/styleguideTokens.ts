/** How a token should be previewed, which is the only thing that differs between them. */
export type TokenKind = 'color' | 'shadow' | 'radius' | 'space' | 'font' | 'motion' | 'raw'

export interface TokenSpec {
  /** Custom property name, without the leading `--` */
  readonly name: string
  readonly kind: TokenKind
  /** Why the token exists, where the name alone does not say it */
  readonly note?: string
}

export interface TokenGroup {
  readonly title: string
  readonly note?: string
  readonly tokens: ReadonlyArray<TokenSpec>
}

/**
 * Every design token the portal defines, grouped the way `tokens.css` groups them.
 *
 * Kept as data rather than as markup so the page is a list to extend rather than a layout to
 * edit, and so a token added to the stylesheet without a line here is visibly missing.
 */
export const TOKEN_GROUPS: ReadonlyArray<TokenGroup> = [
  {
    title: 'Surfaces & text',
    tokens: [
      { name: 'diele-bg', kind: 'color', note: 'the page itself' },
      { name: 'diele-bg-accent', kind: 'color', note: 'a panel lifted off the page' },
      { name: 'diele-surface', kind: 'color', note: 'cards and controls' },
      { name: 'diele-fg', kind: 'color' },
      { name: 'diele-fg-muted', kind: 'color', note: 'second column of a row, hints' },
      { name: 'diele-border', kind: 'color' },
    ],
  },
  {
    title: 'Brand',
    note: 'the accent is replaced at runtime by the configured colour, so this shows what is live',
    tokens: [
      { name: 'diele-accent', kind: 'color', note: 'the tilde, and every hover and focus' },
      { name: 'diele-wordmark', kind: 'color' },
      { name: 'diele-subtitle', kind: 'color' },
      { name: 'diele-rule', kind: 'color', note: 'divider between rows' },
      { name: 'diele-hit', kind: 'color', note: 'backing behind a matched substring' },
      { name: 'diele-marker', kind: 'raw', note: 'the selection glyph, as a content string' },
      { name: 'diele-marker-lift', kind: 'raw', note: 'seats it on the x-height' },
    ],
  },
  {
    title: 'Shape & depth',
    tokens: [
      { name: 'diele-radius', kind: 'radius' },
      { name: 'diele-radius-sm', kind: 'radius' },
      { name: 'diele-shadow', kind: 'shadow' },
      {
        name: 'diele-shadow-hover',
        kind: 'shadow',
        note: 'geometry differs per theme, not only colour',
      },
    ],
  },
  {
    title: 'Status',
    note: 'monitor states, lifted in the dark for contrast',
    tokens: [
      { name: 'diele-status-up', kind: 'color' },
      { name: 'diele-status-down', kind: 'color', note: 'also every error message' },
      { name: 'diele-status-pending', kind: 'color', note: 'also the soon badge' },
      { name: 'diele-status-maintenance', kind: 'color' },
    ],
  },
  {
    title: 'Layout',
    tokens: [
      { name: 'diele-row-label', kind: 'raw', note: 'label track of the row grammar, in ch' },
      { name: 'diele-reveal-gap', kind: 'raw', note: 'room the arrow keys leave around a row' },
    ],
  },
  {
    title: 'Rhythm',
    note: 'the suffix counts steps on a 0.25rem grid, and the grid is gapped: no 5, 7, 9 or 10',
    tokens: [
      { name: 'diele-space-1', kind: 'space' },
      { name: 'diele-space-2', kind: 'space' },
      { name: 'diele-space-3', kind: 'space' },
      { name: 'diele-space-4', kind: 'space' },
      { name: 'diele-space-6', kind: 'space' },
      { name: 'diele-space-8', kind: 'space' },
      { name: 'diele-space-12', kind: 'space' },
    ],
  },
  {
    title: 'Type',
    tokens: [
      { name: 'diele-font', kind: 'font', note: 'the cards and body copy' },
      { name: 'diele-font-mono', kind: 'font', note: 'every row, control and subtitle' },
      { name: 'diele-font-brand', kind: 'font', note: 'the wordmark' },
    ],
  },
  {
    title: 'Type scale',
    note: 'every step derived from the base, so the whole set moves with it',
    tokens: [
      { name: 'diele-text-2xs', kind: 'font' },
      { name: 'diele-text-xs', kind: 'font' },
      { name: 'diele-text-sm', kind: 'font' },
      { name: 'diele-text-md', kind: 'font' },
      { name: 'diele-text-lg', kind: 'font' },
      { name: 'diele-text-xl', kind: 'font' },
      { name: 'diele-text-base', kind: 'font', note: 'the one the rest are derived from' },
      {
        name: 'diele-text-display',
        kind: 'font',
        note: 'the wordmark, scaling with the viewport',
      },
    ],
  },
  {
    title: 'Motion',
    tokens: [
      {
        name: 'diele-transition',
        kind: 'motion',
        note: 'suppressed entirely under prefers-reduced-motion',
      },
    ],
  },
]

/**
 * Reads a token's declaration as written.
 *
 * A custom property is not resolved until something uses it, so a `light-dark()` pair comes
 * back whole rather than as the side the current theme picked. That is the useful half: it
 * says where to edit. `resolveColor` gives the other half.
 * @param {string} name - Custom property name, without the leading `--`
 * @returns {string} - The declared value, trimmed
 */
export function resolveToken(name: string): string {
  if (typeof window === 'undefined') {
    return ''
  }

  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
}

/**
 * Resolves a colour token to the value the current theme actually paints, by making something
 * use it and reading back what the browser computed.
 * @param {string} name - Custom property name, without the leading `--`
 * @returns {string} - Computed colour, or an empty string when it is not a colour
 */
export function resolveColor(name: string): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const probe = document.createElement('span')
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(--${name})`
  document.body.append(probe)

  const computed = getComputedStyle(probe).color
  probe.remove()

  return computed
}
