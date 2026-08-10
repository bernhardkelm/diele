import { describe, expect, it } from 'vitest'
import { searchTargets } from '@/features/portal/searchTargets'
import type {
  CardTarget,
  CommandTarget,
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

describe('sections', () => {
  // Ranking only ever reorders within a section, so the order the arrows walk stays the order
  // the page paints.
  it('orders commands, then suggestions, then cards, then group pages, then repos', () => {
    const found = searchTargets(all, 'deploy')

    expect(found.map((target) => target.ref)).toEqual([
      'cmd:1',
      'site:1',
      'card:1',
      'gitlab:1:group-1',
      'gitlab:1:project-1',
    ])
  })

  // A group page leads its own repos, the way it does without a term.
  it('puts a group page ahead of the repos under it', () => {
    const found = searchTargets([repo, group], 'deploy')

    expect(found[0]!.ref).toBe('gitlab:1:group-1')
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
