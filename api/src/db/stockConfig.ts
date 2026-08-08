export interface StockEngine {
  readonly name: string
  readonly urlTemplate: string
  readonly enabled: boolean
}

export interface StockCommand {
  readonly keyword: string
  readonly label: string
  readonly urlTemplate: string
  readonly enabled: boolean
}

export interface StockPort {
  readonly scheme: 'http' | 'https'
  readonly port: number
  readonly keywords: ReadonlyArray<string>
}

/**
 * What a fresh portal submits `↵` to. Only the first two are on: `Tab` cycles the enabled ones,
 * so a long ring is a ring nobody walks, and the rest are here to be switched on rather than
 * typed out.
 */
export const STOCK_ENGINES: ReadonlyArray<StockEngine> = [
  { name: 'DuckDuckGo', urlTemplate: 'https://duckduckgo.com/?q={query}', enabled: true },
  { name: 'Google', urlTemplate: 'https://www.google.com/search?q={query}', enabled: true },
  {
    name: 'Wikipedia',
    urlTemplate: 'https://en.wikipedia.org/w/index.php?search={query}',
    enabled: false,
  },
  { name: 'Ecosia', urlTemplate: 'https://www.ecosia.org/search?q={query}', enabled: false },
]

/**
 * The commands a fresh portal knows. `admin`, `settings` and `logout` are absent because the
 * portal answers to those itself and refuses a row that redefines one.
 *
 * A row that assumes a particular host ships off. `gl` is the case that makes the rule: a
 * self-hosted GitLab is the common one, so a row pointing at gitlab.com would be wrong rather
 * than merely unused.
 */
export const STOCK_COMMANDS: ReadonlyArray<StockCommand> = [
  {
    keyword: 'gh',
    label: 'Search GitHub',
    urlTemplate: 'https://github.com/search?q={query}',
    enabled: true,
  },
  {
    keyword: 'mdn',
    label: 'Search MDN',
    urlTemplate: 'https://developer.mozilla.org/en-US/search?q={query}',
    enabled: true,
  },
  {
    keyword: 'npm',
    label: 'Search npm',
    urlTemplate: 'https://www.npmjs.com/search?q={query}',
    enabled: true,
  },
  {
    keyword: 'so',
    label: 'Search Stack Overflow',
    urlTemplate: 'https://stackoverflow.com/search?q={query}',
    enabled: true,
  },
  {
    keyword: 'gl',
    label: 'Search GitLab',
    urlTemplate: 'https://gitlab.com/search?search={query}',
    enabled: false,
  },
  {
    keyword: 'yt',
    label: 'Search YouTube',
    urlTemplate: 'https://www.youtube.com/results?search_query={query}',
    enabled: false,
  },
  {
    keyword: 'dh',
    label: 'Search Docker Hub',
    urlTemplate: 'https://hub.docker.com/search?q={query}',
    enabled: false,
  },
  {
    keyword: 'ciu',
    label: 'Can I use',
    urlTemplate: 'https://caniuse.com/?search={query}',
    enabled: false,
  },
  {
    keyword: 'maps',
    label: 'Open in Maps',
    urlTemplate: 'https://www.google.com/maps/search/{query}',
    enabled: false,
  },
  {
    keyword: 'tr',
    label: 'Translate',
    urlTemplate: 'https://translate.google.com/?sl=auto&tl=en&op=translate&text={query}',
    enabled: false,
  },
]

/**
 * The ports a development machine tends to be running something on. The rows are on while the
 * feature itself is off, so nothing is probed until someone switches local ports on, and when
 * they do it works without three rows having to be typed in first.
 */
export const STOCK_PORTS: ReadonlyArray<StockPort> = [
  { scheme: 'http', port: 3000, keywords: ['api'] },
  { scheme: 'http', port: 5173, keywords: ['vite', 'web'] },
  { scheme: 'http', port: 8080, keywords: ['proxy'] },
]
