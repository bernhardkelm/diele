import { describe, expect, it } from 'vitest'
import { pasteTargetFor } from '@/features/portal/pasteTarget'

describe('terms that are really urls', () => {
  it('takes a term carrying a scheme as written', () => {
    const target = pasteTargetFor('https://example.com/path?q=1')

    expect(target?.url).toBe('https://example.com/path?q=1')
    expect(target?.name).toBe('Go to')
    expect(target?.display).toBe('example.com/path')
  })

  it('assumes https for a bare host on a known suffix', () => {
    expect(pasteTargetFor('example.com')?.url).toBe('https://example.com/')
    expect(pasteTargetFor('docs.example.dev/guide')?.url).toBe('https://docs.example.dev/guide')
  })

  // A dev server is served over plain http, so guessing https would offer a link that fails.
  it('assumes http for localhost and loopback', () => {
    expect(pasteTargetFor('localhost:5173')?.url).toBe('http://localhost:5173/')
    expect(pasteTargetFor('127.0.0.1:3000/admin')?.url).toBe('http://127.0.0.1:3000/admin')
  })

  it('shows the host alone when the url has no path of its own', () => {
    expect(pasteTargetFor('https://example.com')?.display).toBe('example.com')
    expect(pasteTargetFor('https://example.com/')?.display).toBe('example.com')
  })

  // Built from the typed term rather than saved, so opening it is worth recording.
  it('marks the entry as made up on the spot', () => {
    const target = pasteTargetFor('example.com')

    expect(target?.adHoc).toBe(true)
    expect(target?.searchOnly).toBe(true)
    expect(target?.keywords).toEqual([])
    expect(target?.ref).toBe('adhoc:https://example.com/')
  })
})

describe('terms that are not urls', () => {
  it('offers nothing for an ordinary search', () => {
    for (const term of ['grafana', 'how do i', '', '   ', 'two words']) {
      expect(pasteTargetFor(term), term).toBeUndefined()
    }
  })

  // Any two-plus letter suffix would swallow these, and offering to navigate to them as the
  // auto-selected first hit would be worse than not offering at all.
  it('offers nothing for a filename that merely looks host-like', () => {
    for (const term of ['sites.json', 'App.vue', 'index.ts', 'notes.md', 'main.rs']) {
      expect(pasteTargetFor(term), term).toBeUndefined()
    }
  })

  it('offers nothing for a host on a suffix it does not know', () => {
    expect(pasteTargetFor('example.zzz')).toBeUndefined()
  })

  it('offers nothing for a term that will not parse as a url', () => {
    expect(pasteTargetFor('https://')).toBeUndefined()
  })

  it('offers nothing for a term with whitespace in it', () => {
    expect(pasteTargetFor('https://example.com and more')).toBeUndefined()
  })
})

it('trims before deciding, so a pasted term with spaces around it still counts', () => {
  expect(pasteTargetFor('  https://example.com  ')?.url).toBe('https://example.com/')
})
