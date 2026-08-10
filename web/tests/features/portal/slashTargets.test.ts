import { beforeEach, describe, expect, it, vi } from 'vitest'
import { slashTargetsFor, type SlashContext } from '@/features/portal/slashTargets'
import type { ApiCommand } from '@diele/common'
import type { CommandTarget } from '@/types/portal'

const command: ApiCommand = {
  id: 1,
  ref: 'cmd:1',
  keyword: 'yt',
  label: 'YouTube',
  urlTemplate: 'https://www.youtube.com/results?search_query={query}',
  position: 1000,
}

let context: { -readonly [K in keyof SlashContext]: SlashContext[K] }

beforeEach(() => {
  context = {
    commands: [command],
    openAdmin: vi.fn(),
    openSettings: vi.fn(),
    offersAdmin: true,
    signOut: vi.fn(),
    userName: 'Ada',
    prefill: vi.fn(),
  }
})

/**
 * Resolves a term and reports the names of the entries it produced.
 * @param {string} term - Term as typed
 * @returns {string[] | undefined} - Entry names, or undefined when the term is not a command
 */
function names(term: string): string[] | undefined {
  return slashTargetsFor(term, context)?.map((target) => target.name)
}

/**
 * Resolves a term to its single entry, narrowed to the command it must be. A configured
 * command resolves to a link instead, so the narrowing is the assertion.
 * @param {string} term - Term as typed
 * @returns {CommandTarget} - The one entry the term produced
 */
function commandFor(term: string): CommandTarget {
  const [target] = slashTargetsFor(term, context)!

  expect(target?.kind).toBe('command')

  return target as CommandTarget
}

// What leaves an ordinary search, a pasted url and a subreddit path working as they did.
describe('terms that are not slash commands', () => {
  it('answers with nothing to say rather than an empty menu', () => {
    for (const term of ['grafana', '', 'https://example.com', '/r/vuejs']) {
      expect(slashTargetsFor(term, context), JSON.stringify(term)).toBeUndefined()
    }
  })
})

describe('while the keyword is still being typed', () => {
  it('offers everything a bare slash could still become', () => {
    expect(names('/')).toEqual(['/admin', '/logout', '/settings', '/yt'])
  })

  it('narrows to what the prefix could still become', () => {
    expect(names('/s')).toEqual(['/settings'])
    expect(names('/lo')).toEqual(['/logout'])
    expect(names('/y')).toEqual(['/yt'])
  })

  it('offers nothing for a prefix nothing starts with', () => {
    expect(names('/zzz')).toEqual([])
  })

  // An account told it may not configure never sees the entry, in the menu or settled.
  it('leaves the admin entry out for an account that may not configure', () => {
    context.offersAdmin = false

    expect(names('/')).toEqual(['/logout', '/settings', '/yt'])
    expect(names('/admin')).toEqual([])
    expect(names('/admin ')).toEqual([])
  })
})

describe('once the keyword is settled', () => {
  it('offers the built-in the keyword names', () => {
    expect(names('/settings ')).toEqual(['/settings'])
    expect(names('/admin ')).toEqual(['/admin'])
    expect(names('/logout ')).toEqual(['/logout'])
  })

  it('runs the built-in rather than navigating', () => {
    commandFor('/settings ').run()
    expect(context.openSettings).toHaveBeenCalled()

    commandFor('/admin ').run()
    expect(context.openAdmin).toHaveBeenCalled()

    commandFor('/logout ').run()
    expect(context.signOut).toHaveBeenCalled()
  })

  it('names who is being signed out', () => {
    expect(commandFor('/logout ').hint).toBe('ends the session for Ada')

    context.userName = null
    expect(commandFor('/logout ').hint).toBe('ends the session')
  })

  // Without a term there is nothing to search for yet, so the entry stands and waits.
  it('waits with the menu entry for a configured command carrying no term', () => {
    const entries = slashTargetsFor('/yt ', context)!

    expect(entries[0]!.name).toBe('/yt')
    expect(entries[0]!.url).toBe('')
  })

  it('resolves a configured command once a term follows it', () => {
    const entries = slashTargetsFor('/yt vue router', context)!

    expect(entries[0]!.name).toBe('YouTube: vue router')
    expect(entries[0]!.url).toBe('https://www.youtube.com/results?search_query=vue%20router')
  })

  it('offers nothing for a settled keyword nothing defines', () => {
    expect(names('/nope something')).toEqual([])
  })
})

// The launcher shows these only while a term is being searched, never on the resting page.
it('marks every entry it produces as search-only', () => {
  for (const term of ['/', '/s', '/yt ', '/yt vue', '/logout ']) {
    for (const target of slashTargetsFor(term, context)!) {
      expect(target.searchOnly, `${term} / ${target.name}`).toBe(true)
    }
  }
})
