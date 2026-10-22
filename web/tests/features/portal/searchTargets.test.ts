import { describe, expect, it } from 'vitest'
import { searchTargets } from '@/features/portal/searchTargets'
import type {
  CardTarget,
  CommandTarget,
  HistoryTarget,
  PortalTarget,
  RowTarget,
  SuggestionTarget,
} from '@/types/portal'

const command: CommandTarget = {
  ref: 'cmd:1',
  kind: 'command',
  name: '/deploy',
  url: '',
  hint: 'deploy things',
  run: () => {},
}

const suggestion: SuggestionTarget = {
  ref: 'site:1',
  kind: 'suggestion',
  name: 'deploy docs',
  url: 'https://docs.example.com',
}

const card: CardTarget = {
  ref: 'card:1',
  kind: 'card',
  name: 'deploy dashboard',
  url: 'https://deploy.example.com',
  icon: '',
  color: 'currentColor',
}

const group: RowTarget = {
  ref: 'gitlab:1:group-1',
  kind: 'row',
  name: 'deploy-group',
  url: 'https://gitlab.example/deploy-group',
  searchOnly: true,
}

const repo: RowTarget = {
  ref: 'gitlab:1:project-1',
  kind: 'row',
  name: 'deploy-service',
  url: 'https://gitlab.example/deploy-group/deploy-service',
}

const all: ReadonlyArray<PortalTarget> = [repo, card, group, suggestion, command]

describe('an empty query', () => {
  it('hands the targets back untouched, in the order they came', () => {
    expect(searchTargets(all, '')).toBe(all)
    expect(searchTargets(all, '   ')).toBe(all)
  })
})

/**
 * Builds a visited page the way the history serves it.
 * @param {string} url - Address of the page
 * @param {string} [title] - Title the page set, if any
 * @returns {HistoryTarget} - Search-only target for it
 */
function visited(url: string, title?: string): HistoryTarget {
  const display = new URL(url).host.replace(/^www\./, '')

  return {
    ref: `history:${url}`,
    kind: 'history',
    name: title ?? display,
    ...(title ? { title } : {}),
    url,
    display,
    searchOnly: true,
  }
}

/**
 * Builds a repo row the way a forge connector serves it.
 * @param {string} path - Namespace and name, `group/name`
 * @returns {RowTarget} - Row for the repo
 */
function repoAt(path: string): RowTarget {
  const slash = path.lastIndexOf('/')

  return {
    ref: `github:1:${path}`,
    kind: 'row',
    name: path.slice(slash + 1),
    detail: path.slice(0, slash),
    url: `https://github.com/${path}`,
  }
}

/**
 * Reads the refs of what a query found.
 * @param {ReadonlyArray<PortalTarget>} targets - Everything searchable
 * @param {string} query - Term as typed
 * @returns {string[]} - Refs of the matches, in order
 */
function refsFor(targets: ReadonlyArray<PortalTarget>, query: string): string[] {
  return searchTargets(targets, query).map((target) => target.ref)
}

describe('sections', () => {
  // The page draws each block as one list or one grid, so ranking may move a block but never
  // split one, which keeps the order the arrows walk the order the page paints.
  it('keeps every block whole', () => {
    const found = searchTargets([repo, card, group, suggestion, command], 'deploy')
    const kinds = found.map((target) => target.kind)

    for (const kind of new Set(kinds)) {
      const first = kinds.indexOf(kind)
      const last = kinds.lastIndexOf(kind)

      expect(kinds.slice(first, last + 1).every((each) => each === kind)).toBe(true)
    }
  })

  it('orders blocks matching equally well in their resting order', () => {
    const page = visited('https://kuma.example/', 'kuma')
    const found = refsFor(
      [page, { ...repo, name: 'kuma' }, { ...card, name: 'kuma' }, { ...suggestion, name: 'kuma' }],
      'kuma',
    )

    expect(found).toEqual(['site:1', 'card:1', 'gitlab:1:project-1', page.ref])
  })

  // A group page leads its own repos, the way it does without a term.
  it('puts a group page ahead of the repos under it, even where a repo matches better', () => {
    const found = searchTargets([{ ...repo, name: 'deploy' }, group], 'deploy')

    expect(found[0]!.ref).toBe('gitlab:1:group-1')
  })

  it('lets a block with a far better match lead one the portal knows better', () => {
    const page = visited('https://deploy.example/')
    const weak: CardTarget = { ...card, name: 'Docs Edit Preview Live Online Yard' }

    expect(refsFor([weak, page], 'deploy')).toEqual([page.ref, 'card:1'])
  })

  it('finds a visited page by its host and by a segment of its path', () => {
    const page: HistoryTarget = {
      ref: 'history:2',
      kind: 'history',
      name: 'Untitled',
      url: 'https://github.com/example/diele/pulls',
      display: 'github.com/example/diele/pulls',
      searchOnly: true,
    }

    expect(searchTargets([page], 'github')).toEqual([page])
    expect(searchTargets([page], 'pulls')).toEqual([page])
    expect(searchTargets([page], 'diele pulls')).toEqual([page])
    expect(searchTargets([page], 'gitlab')).toEqual([])
  })
})

describe('ranking inside a section', () => {
  it('puts the better match first', () => {
    const exact: CardTarget = { ...card, ref: 'card:2', name: 'kuma' }
    const partial: CardTarget = { ...card, ref: 'card:3', name: 'uptime kuma mirror' }

    expect(searchTargets([partial, exact], 'kuma').map((t) => t.ref)).toEqual(['card:2', 'card:3'])
  })

  it('keeps the original order between two equally good matches', () => {
    const first: CardTarget = { ...card, ref: 'card:a', name: 'kuma' }
    const second: CardTarget = { ...card, ref: 'card:b', name: 'kuma' }

    expect(searchTargets([first, second], 'kuma').map((t) => t.ref)).toEqual(['card:a', 'card:b'])
  })

  it('lets a boost lift a target above an otherwise better match', () => {
    const plain: CardTarget = { ...card, ref: 'card:plain', name: 'kuma' }
    const opened: CardTarget = { ...card, ref: 'card:opened', name: 'uptime kuma mirror' }

    const boosted = searchTargets([plain, opened], 'kuma', (target) =>
      target.ref === 'card:opened' ? 1000 : 0,
    )

    expect(boosted[0]!.ref).toBe('card:opened')
  })

  it('applies no boost when none is given', () => {
    expect(searchTargets(all, 'deploy')).toHaveLength(5)
  })
})

describe('filtering', () => {
  it('drops what the query does not match', () => {
    expect(searchTargets(all, 'zzznothing')).toEqual([])
  })

  it('narrows as a second token is typed', () => {
    const found = searchTargets(all, 'deploy service')

    expect(found.map((target) => target.ref)).toEqual(['gitlab:1:project-1'])
  })

  it('leaves the list it was given alone', () => {
    const before = [...all]
    searchTargets(all, 'deploy')

    expect(all).toEqual(before)
  })
})

describe('targets made up from the term', () => {
  const goTo: SuggestionTarget = {
    ref: 'adhoc:https://deploy.example/',
    kind: 'suggestion',
    name: 'Go to deploy.example',
    url: 'https://deploy.example/',
    searchOnly: true,
  }

  // A term that produced one is a stronger signal than anything it merely matched.
  it('lead their block, and their block leads the page', () => {
    const found = searchTargets([{ ...card, name: 'deploy' }, suggestion], 'deploy', undefined, [
      goTo,
    ])

    expect(found.map((target) => target.ref)).toEqual([goTo.ref, 'site:1', 'card:1'])
  })

  it('stand on their own when nothing else matches', () => {
    expect(searchTargets<PortalTarget>([card], 'zzznothing', undefined, [goTo])).toEqual([goTo])
  })
})

describe('what the user types', () => {
  const grafana: CardTarget = { ...card, ref: 'card:grafana', name: 'Grafana' }
  const prometheus: CardTarget = { ...card, ref: 'card:prometheus', name: 'Prometheus' }
  const kuma: CardTarget = { ...card, ref: 'card:kuma', name: 'Uptime Kuma' }
  const port: SuggestionTarget = {
    ref: 'localhost:5173',
    kind: 'suggestion',
    name: 'localhost:5173',
    url: 'http://localhost:5173',
    keywords: ['5173', 'localhost', 'lh', 'vite'],
    searchOnly: true,
  }
  const web = repoAt('example-group/web')
  const repos = [
    repoAt('Klickmeister/freiheit-und-gleichheit-in-der-bildungsgeschichte'),
    repoAt('bernhardkelm/undisclosed'),
    repoAt('bernhardkelm/miwo_datasets'),
    web,
  ]
  const heise = visited(
    'https://www.heise.de/',
    'heise online - IT-News, Nachrichten und Hintergründe | heise online',
  )
  const portal = [grafana, prometheus, kuma, port, ...repos, heise]

  // Scattered letters used to match ten repos here and leave the page that was meant last.
  it('finds a visited site by its name first, and no repo by scattered letters', () => {
    expect(refsFor(portal, 'heise')).toEqual([heise.ref])
  })

  it('finds a card through a typo', () => {
    expect(refsFor(portal, 'prometeus')).toEqual(['card:prometheus'])
  })

  it('finds a card through two swapped letters', () => {
    expect(refsFor(portal, 'grafna')).toEqual(['card:grafana'])
  })

  it('finds a card by its initials and by the start of its name', () => {
    expect(refsFor(portal, 'uk')).toEqual(['card:kuma'])
    expect(refsFor(portal, 'graf')).toEqual(['card:grafana'])
  })

  it('finds nothing through a typo in a three letter term', () => {
    expect(refsFor(portal, 'grf')).toEqual([])
    expect(refsFor(portal, 'prm')).toEqual([])
  })

  it('finds a repo by both halves of its path', () => {
    expect(refsFor(portal, 'example-group/web')).toEqual([web.ref])
  })

  it('finds a local port by its keyword', () => {
    expect(refsFor(portal, 'lh')).toEqual([port.ref])
  })

  // A quoted term is held to a literal hit, so no typo and no initials stand in for it.
  it('reads a quoted term literally', () => {
    const exact: CardTarget = { ...card, ref: 'card:exact', name: 'Exact term board' }
    const typo: CardTarget = { ...card, ref: 'card:typo', name: 'Exakt term board' }
    const apart: CardTarget = { ...card, ref: 'card:apart', name: 'term, exact' }

    expect(refsFor([typo, apart, exact], '"exact term"')).toEqual(['card:exact'])
    expect(refsFor([typo, apart, exact], 'exact term').sort()).toEqual(['card:apart', 'card:exact'])
  })

  // On a tie what the portal was told about wins over a page merely visited.
  it('puts a known block first when it matches as well as a visited page', () => {
    const named: CardTarget = { ...grafana, ref: 'card:heise', name: 'Heise' }
    const tagged: CardTarget = { ...grafana, ref: 'card:news', name: 'News', keywords: ['heise'] }

    expect(refsFor([heise, named], 'heise')).toEqual(['card:heise', heise.ref])
    expect(refsFor([heise, tagged], 'heise')).toEqual(['card:news', heise.ref])
  })

  it('puts a visited page first when it matches far better than a known block', () => {
    const nytimes = visited('https://www.nytimes.com/', 'The New York Times')
    const initials = repoAt('bernhardkelm/new-york-tools')

    expect(refsFor([initials, nytimes], 'nyt')).toEqual([nytimes.ref, initials.ref])
  })

  // A typo only fills in where nothing matches literally.
  it('drops what only a typo found once something matched literally', () => {
    const nytimes = visited('https://www.nytimes.com/', 'The New York Times')
    const typo = repoAt('bernhardkelm/nytimez-scraper')

    expect(refsFor([typo, nytimes], 'nytimes')).toEqual([nytimes.ref])
    expect(refsFor([typo], 'nytimes')).toEqual([typo.ref])
  })

  it('shows no repo found by a typo beside a card found by a substring', () => {
    const substring: CardTarget = { ...card, ref: 'card:super', name: 'supergrafana' }
    const typo = repoAt('example-group/grafna-dashboards')

    expect(refsFor([typo, substring], 'grafana')).toEqual(['card:super'])
  })
})
