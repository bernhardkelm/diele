import { describe, expect, it } from 'vitest'
import { dropGuesses } from '@/helpers/dropGuesses'
import { MATCH_TIERS } from '@/helpers/matchTiers'

describe('dropGuesses', () => {
  it('drops the typos once something matched at substring or better', () => {
    const entries = [
      { id: 'typo', tier: MATCH_TIERS.TYPO },
      { id: 'substring', tier: MATCH_TIERS.SUBSTRING },
      { id: 'acronym', tier: MATCH_TIERS.ACRONYM },
    ]

    expect(dropGuesses(entries).map((entry) => entry.id)).toEqual(['substring', 'acronym'])
  })

  it('keeps the typos beside nothing better than an acronym', () => {
    const entries = [
      { id: 'typo', tier: MATCH_TIERS.TYPO },
      { id: 'acronym', tier: MATCH_TIERS.ACRONYM },
    ]

    expect(dropGuesses(entries)).toEqual(entries)
  })

  it('keeps an entry without a tier either way', () => {
    const entries = [{ id: 'open' }, { id: 'exact', tier: MATCH_TIERS.EXACT }]

    expect(dropGuesses(entries)).toEqual(entries)
  })
})
