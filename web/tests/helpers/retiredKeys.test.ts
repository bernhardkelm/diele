import { beforeEach, describe, expect, it } from 'vitest'
import { dropRetiredKeys } from '@/helpers/retiredKeys'

beforeEach(() => {
  localStorage.clear()
})

describe('dropRetiredKeys', () => {
  // It held the origin of every address typed into the field, and nothing reads it any more.
  it('removes the visited list an older build kept', () => {
    localStorage.setItem('diele:visited-urls', JSON.stringify(['https://typed.example']))

    dropRetiredKeys()

    expect(localStorage.getItem('diele:visited-urls')).toBeNull()
  })

  it('leaves what is still read alone', () => {
    localStorage.setItem('diele:launch-history:v2', JSON.stringify(['card:1']))
    localStorage.setItem('diele:theme', 'dark')

    dropRetiredKeys()

    expect(localStorage.getItem('diele:launch-history:v2')).not.toBeNull()
    expect(localStorage.getItem('diele:theme')).toBe('dark')
  })

  it('does nothing when there is nothing to drop', () => {
    expect(() => dropRetiredKeys()).not.toThrow()
  })
})
