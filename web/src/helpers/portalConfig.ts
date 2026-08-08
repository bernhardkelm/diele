import type {
  ApiBrand,
  ApiCommand,
  ApiConfig,
  ApiLink,
  ApiLocalhostPort,
  ApiSearchEngine,
} from '@diele/common'
import type { CardTarget, SearchEngine, SuggestionTarget } from '@/types/portal'

export interface PortalConfig {
  readonly brand: ApiBrand
  readonly cards: ReadonlyArray<CardTarget>
  readonly sites: ReadonlyArray<SuggestionTarget>
  readonly engines: ReadonlyArray<SearchEngine>
  readonly commands: ReadonlyArray<ApiCommand>
  readonly settings: Record<string, unknown>
}

// Matches the API's own defaults, so a portal that has never reached it still reads as a
// portal rather than as a blank page.
export const DEFAULT_BRAND: ApiBrand = {
  title: 'portal',
  subtitle: 'start page',
  accentLight: '#16a34a',
  accentDark: '#22c55e',
}

export const EMPTY_CONFIG: PortalConfig = {
  brand: DEFAULT_BRAND,
  cards: [],
  sites: [],
  engines: [],
  commands: [],
  settings: {},
}

/**
 * Maps a card row onto the shape the components already render. The markup arrives sanitised
 * and recoloured, so it is inlined as it comes.
 * @param {ApiLink} link - Card as the API serves it
 * @returns {CardTarget} - Card for the grid
 */
function toCard(link: ApiLink): CardTarget {
  return {
    ref: link.ref,
    kind: 'card',
    name: link.label,
    url: link.url,
    keywords: link.keywords,
    icon: link.icon ?? '',
    color: link.color ?? 'currentColor',
  }
}

/**
 * Maps a saved site row onto the search-target shape.
 * @param {ApiLink} link - Site as the API serves it
 * @returns {SuggestionTarget} - Saved site for the launcher
 */
function toSite(link: ApiLink): SuggestionTarget {
  return {
    ref: link.ref,
    kind: 'suggestion',
    name: link.label,
    url: link.url,
    keywords: link.keywords,
    ...(link.display ? { display: link.display } : {}),
    searchOnly: true,
  }
}

/**
 * Maps a local port onto a search target. It joins the saved sites rather than forming its own
 * section: it renders the same way and is probed by the same code, only its configuration is
 * separate because a port is a scheme and a number rather than a url someone typed.
 * @param {ApiLocalhostPort} entry - Port as the API serves it
 * @returns {SuggestionTarget} - Suggestion for the launcher
 */
function toLocalhostSite(entry: ApiLocalhostPort): SuggestionTarget {
  const tags = entry.keywords ?? []

  return {
    ref: entry.ref,
    kind: 'suggestion',
    name: `localhost:${entry.port}`,
    url: entry.url,
    keywords: [String(entry.port), 'localhost', 'lh', ...tags],
    // the first tag says what runs there, which is more use in the second column than the
    // scheme; without one the host stands in, as it does for any other site
    display: tags[0],
    searchOnly: true,
  }
}

/**
 * Maps an engine row onto the shape the search bar cycles through.
 * @param {ApiSearchEngine} engine - Engine as the API serves it
 * @returns {SearchEngine} - Engine for the bar
 */
function toEngine(engine: ApiSearchEngine): SearchEngine {
  return {
    id: String(engine.id),
    name: engine.name,
    urlTemplate: engine.urlTemplate,
  }
}

/**
 * Converts a whole config payload into the domain shapes the app renders, so nothing
 * downstream has to know the wire format.
 * @param {ApiConfig} payload - Config as the API serves it
 * @returns {PortalConfig} - The same configuration in the app's own shapes
 */
export function toPortalConfig(payload: ApiConfig): PortalConfig {
  return {
    brand: payload.brand ?? DEFAULT_BRAND,
    cards: payload.cards.map(toCard),
    sites: [...payload.sites.map(toSite), ...(payload.localhost ?? []).map(toLocalhostSite)],
    engines: payload.engines.map(toEngine),
    commands: payload.commands ?? [],
    settings: payload.settings,
  }
}
