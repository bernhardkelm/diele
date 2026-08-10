import { describe, expect, it } from 'vitest'
import { subredditTargetFor } from '@/features/portal/subredditTarget'

describe('subredditTargetFor', () => {
  it('reads a subreddit path as reddit writes it', () => {
    const target = subredditTargetFor('r/vuejs')

    expect(target?.name).toBe('r/vuejs')
    expect(target?.url).toBe('https://www.reddit.com/r/vuejs/')
    expect(target?.display).toBe('reddit.com')
  })

  it('accepts the leading and trailing slash a pasted path carries', () => {
    expect(subredditTargetFor('/r/vuejs')?.url).toBe('https://www.reddit.com/r/vuejs/')
    expect(subredditTargetFor('r/vuejs/')?.url).toBe('https://www.reddit.com/r/vuejs/')
    expect(subredditTargetFor('/r/vuejs/')?.url).toBe('https://www.reddit.com/r/vuejs/')
  })

  it('is case-insensitive on the prefix and keeps the name as typed', () => {
    expect(subredditTargetFor('R/VueJS')?.name).toBe('r/VueJS')
  })

  it('trims first', () => {
    expect(subredditTargetFor('  r/vuejs  ')?.url).toBe('https://www.reddit.com/r/vuejs/')
  })

  it('marks the entry search-only, so it never stands on the resting page', () => {
    const target = subredditTargetFor('r/vuejs')

    expect(target?.searchOnly).toBe(true)
    expect(target?.keywords).toEqual([])
    expect(target?.adHoc).toBeUndefined()
  })

  it('offers nothing for anything that is not a subreddit path', () => {
    for (const term of [
      'vuejs',
      'r/',
      'r',
      '/r/',
      'r/vue js',
      'r/vuejs/comments/123',
      'x/vuejs',
      'r/' + 'a'.repeat(22),
      'r/vue-js',
      '',
    ]) {
      expect(subredditTargetFor(term), JSON.stringify(term)).toBeUndefined()
    }
  })

  it('accepts the full length reddit itself allows', () => {
    expect(subredditTargetFor('r/' + 'a'.repeat(21))).toBeDefined()
  })

  it('accepts underscores and digits', () => {
    expect(subredditTargetFor('r/vue_js2')?.name).toBe('r/vue_js2')
  })
})
