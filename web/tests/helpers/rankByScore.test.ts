import { describe, expect, it } from 'vitest'
import { rankByScore } from '@/helpers/rankByScore'
import type { SearchField } from '@/helpers/searchFields'

interface Item {
  readonly name: string
  readonly boost?: number
}

function fieldsOf(item: Item): ReadonlyArray<SearchField> {
  return [{ text: item.name, weight: 1 }]
}

const items: ReadonlyArray<Item> = [
  { name: 'Grafana' },
  { name: 'GitLab' },
  { name: 'Grafana Loki' },
]

describe('rankByScore', () => {
  it('returns the items untouched for a blank query', () => {
    expect(rankByScore(items, '', fieldsOf)).toBe(items)
    expect(rankByScore(items, '   ', fieldsOf)).toBe(items)
  })

  it('drops items the query does not match', () => {
    const ranked = rankByScore(items, 'grafana', fieldsOf)

    expect(ranked.map((item) => item.name)).toEqual(['Grafana', 'Grafana Loki'])
  })

  it('puts the better match first', () => {
    const ranked = rankByScore(items, 'gitlab', fieldsOf)

    expect(ranked[0]?.name).toBe('GitLab')
  })

  // The whole point of quoting: a term short or common enough to reach half the portal has no
  // other way to say it means only itself.
  it('narrows to a literal hit for a quoted term', () => {
    const repos: ReadonlyArray<Item> = [
      { name: 'example-group/web' },
      { name: 'example-group/web-ui' },
      { name: 'example-app/webhooks' },
    ]

    expect(rankByScore(repos, 'exam we', fieldsOf).map((item) => item.name)).toHaveLength(3)
    expect(rankByScore(repos, '"example-group/web"', fieldsOf).map((item) => item.name)).toEqual([
      'example-group/web',
      'example-group/web-ui',
    ])
  })

  it('keeps source order between equal scores', () => {
    const twins: ReadonlyArray<Item> = [{ name: 'alpha one' }, { name: 'alpha two' }]
    const ranked = rankByScore(twins, 'alpha', fieldsOf)

    expect(ranked.map((item) => item.name)).toEqual(['alpha one', 'alpha two'])
  })

  it('adds the boost on top of the field score', () => {
    const twins: ReadonlyArray<Item> = [{ name: 'alpha one' }, { name: 'alpha two', boost: 1 }]
    const ranked = rankByScore(twins, 'alpha', fieldsOf, {
      boostFor: (item) => item.boost ?? 0,
    })

    expect(ranked.map((item) => item.name)).toEqual(['alpha two', 'alpha one'])
  })

  // A typo is a guess, worth offering when nothing else answers and noise beside a literal hit.
  it('drops what only a typo found once something matched literally', () => {
    const names: ReadonlyArray<Item> = [{ name: 'Grafana' }, { name: 'Grafna mirror' }]

    expect(rankByScore(names, 'grafana', fieldsOf).map((item) => item.name)).toEqual(['Grafana'])
  })

  it('keeps the typos when nothing matched literally', () => {
    const names: ReadonlyArray<Item> = [{ name: 'Grafana' }, { name: 'Prometheus' }]

    expect(rankByScore(names, 'grafna', fieldsOf).map((item) => item.name)).toEqual(['Grafana'])
  })

  // An acronym is no literal hit, so it leaves the typos standing, ranked below it.
  it('keeps the typos beside an acronym', () => {
    const names: ReadonlyArray<Item> = [{ name: 'Ukmo' }, { name: 'Uptime Kuma Metrics Agent' }]

    expect(rankByScore(names, 'ukma', fieldsOf).map((item) => item.name)).toEqual([
      'Uptime Kuma Metrics Agent',
      'Ukmo',
    ])
  })
})
