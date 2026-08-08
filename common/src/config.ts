/**
 * Everything `GET /api/config` serves. One request paints the whole page, because diele is a
 * new tab page and a second round trip is a second chance to be slow.
 */

export interface ApiBrand {
  readonly title: string
  readonly subtitle: string
  readonly accentLight: string
  readonly accentDark: string
}

export type LinkKind = 'card' | 'site'

export interface ApiLink {
  readonly id: number
  /** Stable identity the client keys its render, history and status on */
  readonly ref: string
  readonly kind: LinkKind
  readonly label: string
  readonly url: string
  readonly display: string | null
  readonly keywords: ReadonlyArray<string>
  /** Sanitised svg markup, joined from the icons table so the client needs no second request */
  readonly icon: string | null
  readonly iconId: number | null
  /** Brand accent a card takes on hover */
  readonly color: string | null
  readonly position: number
}

export interface ApiIcon {
  readonly id: number
  readonly name: string
  /** Sanitised markup, already rewritten to inherit `currentColor` */
  readonly svg: string
}

export interface ApiSearchEngine {
  readonly id: number
  readonly name: string
  /** Query url, with `{query}` standing in for the percent-encoded term */
  readonly urlTemplate: string
  readonly position: number
}

export interface ApiCommand {
  readonly id: number
  /** Stable identity the client keys its render and history on */
  readonly ref: string
  /** The word after the slash */
  readonly keyword: string
  readonly label: string | null
  /** Query url, with `{query}` standing in for whatever follows the keyword */
  readonly urlTemplate: string
  readonly position: number
}

export interface ApiLocalhostPort {
  readonly id: number
  /** Stable identity the client keys its render, history and status on */
  readonly ref: string
  readonly scheme: 'http' | 'https'
  readonly port: number
  /** Free-form tags, so a port is findable by what runs on it and not only by its number */
  readonly keywords: ReadonlyArray<string>
  /** Derived, so the admin list can name a row without knowing what a port is */
  readonly label: string
  /** Derived, never stored: everything but the scheme and the port follows from them */
  readonly url: string
  readonly position: number
}

export interface ApiConfig {
  readonly brand: ApiBrand
  readonly cards: ReadonlyArray<ApiLink>
  readonly sites: ReadonlyArray<ApiLink>
  readonly engines: ReadonlyArray<ApiSearchEngine>
  readonly commands: ReadonlyArray<ApiCommand>
  /** Empty when the feature is off, so the client probes nothing rather than deciding */
  readonly localhost: ReadonlyArray<ApiLocalhostPort>
  readonly settings: Record<string, unknown>
}
