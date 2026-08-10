import { describe, expect, it, vi } from 'vitest'
import { commandMenuEntry, commandTarget, parseSlash } from '@/features/portal/slashCommands'
import type { ApiCommand } from '@diele/common'

const command: ApiCommand = {
  id: 1,
  ref: 'cmd:1',
  keyword: 'yt',
  label: 'YouTube',
  urlTemplate: 'https://www.youtube.com/results?search_query={query}',
  position: 1000,
}

describe('parseSlash', () => {
  it('reads the keyword while it is still being typed', () => {
    expect(parseSlash('/set')).toEqual({ keyword: 'set', args: '', settled: false })
  })

  // The keyword is settled once a space follows it, so the rest of the line is the term.
  it('settles the keyword on the first space', () => {
    expect(parseSlash('/yt ')).toEqual({ keyword: 'yt', args: '', settled: true })
    expect(parseSlash('/yt vue composition')).toEqual({
      keyword: 'yt',
      args: 'vue composition',
      settled: true,
    })
  })

  it('lowercases the keyword and keeps the term as typed', () => {
    expect(parseSlash('/YT Vue Router')).toEqual({
      keyword: 'yt',
      args: 'Vue Router',
      settled: true,
    })
  })

  it('reads a bare slash as a keyword nobody has typed yet', () => {
    expect(parseSlash('/')).toEqual({ keyword: '', args: '', settled: false })
  })

  it('tolerates leading whitespace', () => {
    expect(parseSlash('   /yt')?.keyword).toBe('yt')
  })

  it('reads anything not starting with a slash as not a command', () => {
    for (const term of ['yt', '', '  ', 'search /yt', 'https://example.com']) {
      expect(parseSlash(term), JSON.stringify(term)).toBeUndefined()
    }
  })

  // A keyword carries no slash of its own, which is what keeps `/r/vuejs` a subreddit jump.
  it('refuses a keyword carrying a slash', () => {
    expect(parseSlash('/r/vuejs')).toBeUndefined()
    expect(parseSlash('/a/b')).toBeUndefined()
  })

  it('refuses a keyword that is not a word', () => {
    expect(parseSlash('/-leading')).toBeUndefined()
    expect(parseSlash('/.dot')).toBeUndefined()
  })

  it('accepts the punctuation a keyword may carry inside it', () => {
    expect(parseSlash('/a.b-c_d')?.keyword).toBe('a.b-c_d')
  })
})

describe('commandTarget', () => {
  it('substitutes the term into the template, encoded', () => {
    const target = commandTarget(command, 'vue composition & more')

    expect(target.url).toBe(
      'https://www.youtube.com/results?search_query=vue%20composition%20%26%20more',
    )
  })

  it('names the entry after the label and the term', () => {
    expect(commandTarget(command, 'vue').name).toBe('YouTube: vue')
  })

  it('falls back to the keyword when the command has no label', () => {
    expect(commandTarget({ ...command, label: null }, 'vue').name).toBe('yt: vue')
  })

  it('shows the host in the second column, without the www nobody types', () => {
    expect(commandTarget(command, 'vue').display).toBe('youtube.com')
  })

  it('shows the template itself when it will not parse', () => {
    const broken = { ...command, urlTemplate: 'not a url {query}' }

    expect(commandTarget(broken, 'vue').display).toBe('not a url {query}')
  })

  // Built from the typed term rather than saved, so opening it is worth recording.
  it('marks the entry as made up on the spot', () => {
    const target = commandTarget(command, 'vue')

    expect(target.adHoc).toBe(true)
    expect(target.searchOnly).toBe(true)
  })
})

describe('commandMenuEntry', () => {
  // Types the keyword and a space into the field, so the next keystroke is already the term.
  it('prefills the field rather than navigating', () => {
    const prefill = vi.fn()
    const entry = commandMenuEntry(command, prefill)

    entry.run()

    expect(prefill).toHaveBeenCalledWith('/yt ')
    expect(entry.url).toBe('')
    expect(entry.keepsQuery).toBe(true)
  })

  it('names the entry by its keyword and hints at what it searches', () => {
    expect(commandMenuEntry(command, vi.fn()).name).toBe('/yt')
    expect(commandMenuEntry(command, vi.fn()).hint).toBe('searches YouTube')
  })

  it('hints with the host when the command has no label', () => {
    expect(commandMenuEntry({ ...command, label: null }, vi.fn()).hint).toBe('searches youtube.com')
  })

  it('carries the keyword and label as search terms', () => {
    expect(commandMenuEntry(command, vi.fn()).keywords).toEqual(['yt', 'YouTube'])
  })

  it('keeps the command own ref, so the history keys on the stored row', () => {
    expect(commandMenuEntry(command, vi.fn()).ref).toBe('cmd:1')
  })
})
