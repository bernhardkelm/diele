import { describe, expect, it } from 'vitest'
import { matchItems } from '@/helpers/matchItems'
import { MATCH_TIERS } from '@/helpers/matchTiers'
import type { SearchField } from '@/helpers/searchFields'
import { tokenize } from '@/helpers/searchTokens'

/**
 * Searches each name as a single field.
 * @param {string} name - Item to describe
 * @returns {ReadonlyArray<SearchField>} - Its one field
 */
function fieldsOf(name: string): ReadonlyArray<SearchField> {
  return [{ text: name, weight: 1 }]
}

/**
 * Reads what a query left standing.
 * @param {ReadonlyArray<string>} names - Everything searchable
 * @param {string} query - Term as typed
 * @param {(name: string) => boolean} [keep] - Names listed whatever they match
 * @returns {string[]} - The names left, in source order
 */
function left(
  names: ReadonlyArray<string>,
  query: string,
  keep?: (name: string) => boolean,
): string[] {
  return matchItems(names, fieldsOf, tokenize(query), keep).map((entry) => entry.item)
}

describe('matchItems', () => {
  // A typo is a guess, worth offering when nothing else answers and noise beside a literal hit.
  it('drops what only a typo found once something matched at substring or better', () => {
    expect(left(['Grafna mirror', 'supergrafana'], 'grafana')).toEqual(['supergrafana'])
  })

  it('keeps the typos when nothing matched literally', () => {
    expect(left(['Grafana', 'Prometheus'], 'grafna')).toEqual(['Grafana'])
  })

  // An acronym is no literal hit, so it leaves the typos standing beside it.
  it('keeps the typos beside nothing better than an acronym', () => {
    const found = matchItems(['Ukmo', 'Uptime Kuma Metrics Agent'], fieldsOf, tokenize('ukma'))

    expect(found.map((entry) => [entry.item, entry.match?.tier])).toEqual([
      ['Ukmo', MATCH_TIERS.TYPO],
      ['Uptime Kuma Metrics Agent', MATCH_TIERS.ACRONYM],
    ])
  })

  it('lists a kept item whatever it matches, and never drops it as a guess', () => {
    /**
     * Keeps everything but the literal hit.
     * @param {string} name - Item to test
     * @returns {boolean} - True to keep it
     */
    const open = (name: string): boolean => name !== 'supergrafana'

    expect(left(['Grafna mirror', 'supergrafana', 'Loki'], 'grafana', open)).toEqual([
      'Grafna mirror',
      'supergrafana',
      'Loki',
    ])
  })

  // A kept item has to match literally to set the guesses aside, the way any other item does.
  it('lets a kept item set the guesses aside only by a literal hit', () => {
    /**
     * Keeps the open item.
     * @param {string} name - Item to test
     * @returns {boolean} - True to keep it
     */
    const open = (name: string): boolean => name.startsWith('open')

    expect(left(['open grafana', 'Grafna mirror'], 'grafana', open)).toEqual(['open grafana'])
    expect(left(['open grafna', 'Grafna mirror'], 'grafana', open)).toEqual([
      'open grafna',
      'Grafna mirror',
    ])
  })

  it('keeps a typo on a heavier field where it scores above a literal hit on a lighter one', () => {
    /**
     * Searches a name, and a shared host far lighter.
     * @param {string} name - Item to describe
     * @returns {ReadonlyArray<SearchField>} - Its two fields
     */
    const fields = (name: string): ReadonlyArray<SearchField> => [
      { text: name, weight: 1 },
      { text: 'grafana.example', weight: 0.3 },
    ]
    const [found] = matchItems(['Grafna'], fields, tokenize('grafana'))

    expect(found?.match?.tier).toBe(MATCH_TIERS.PREFIX)
    // the prefix hit on the host weighs in under 220, the typo on the name at 249
    expect(found?.match?.score).toBe(249)
  })
})
