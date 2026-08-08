import { describe, expect, it } from 'vitest'
import { rankByScore } from '@/helpers/rankByScore'
import type { SearchField } from '@/helpers/searchFields'

interface Item {
  readonly name: string
  readonly section?: number
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

  // Ranking only ever reorders within a section, so match order follows paint order.
  it('never lifts an item across sections, however well it scores', () => {
    const sectioned: ReadonlyArray<Item> = [
      { name: 'alphabetical', section: 1 },
      { name: 'alpha', section: 2 },
    ]
    const ranked = rankByScore(sectioned, 'alpha', fieldsOf, {
      sectionOf: (item) => item.section ?? 0,
    })

    expect(ranked.map((item) => item.name)).toEqual(['alphabetical', 'alpha'])
  })
})
