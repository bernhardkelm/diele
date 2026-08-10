import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TOKEN_GROUPS, resolveColor, resolveToken } from '@/features/styleguide/styleguideTokens'
import {
  CARD,
  COMMANDS,
  ENTRY_ACTIONS,
  ENTRY_ROWS,
  FEATURE,
  SELECT_OPTIONS,
  SITES,
} from '@/features/styleguide/styleguideSpecimens'

// Resolved from the package root rather than from `import.meta.url`: the test runs in a
// document environment, where that is an http url and cannot be turned into a path.
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

afterEach(() => {
  document.documentElement.style.cssText = ''
})

describe('the token catalogue', () => {
  it('groups every token under a title', () => {
    expect(TOKEN_GROUPS.length).toBeGreaterThan(0)

    for (const group of TOKEN_GROUPS) {
      expect(group.title).not.toBe('')
      expect(group.tokens.length).toBeGreaterThan(0)
    }
  })

  it('names each token once across the whole catalogue', () => {
    const names = TOKEN_GROUPS.flatMap((group) => group.tokens.map((token) => token.name))

    expect(new Set(names).size).toBe(names.length)
  })

  it('names them without the leading dashes the stylesheet writes', () => {
    for (const group of TOKEN_GROUPS) {
      for (const token of group.tokens) {
        expect(token.name.startsWith('--'), token.name).toBe(false)
      }
    }
  })

  // A token listed here that the stylesheet does not declare renders as a blank swatch, which
  // is the failure this page exists to make visible - so it must not be one of ours.
  it('lists only tokens the stylesheet actually declares', () => {
    const missing = TOKEN_GROUPS.flatMap((group) => group.tokens)
      .map((token) => token.name)
      .filter((name) => !tokensCss.includes(`--${name}:`))

    expect(missing).toEqual([])
  })
})

describe('resolving a token', () => {
  it('reads the declared value back, trimmed', () => {
    document.documentElement.style.setProperty('--diele-space-4', '  1rem  ')

    expect(resolveToken('diele-space-4')).toBe('1rem')
  })

  it('reads a token nothing declares as empty', () => {
    expect(resolveToken('diele-not-a-token')).toBe('')
  })

  // Resolved by making something use the token and reading back what the browser computed,
  // which is the only way to see through a `light-dark()` pair. What it computes to is the
  // engine's business and jsdom does not substitute `var()` at all, so only the mechanism is
  // asserted here.
  it('answers for a colour by making something use it', () => {
    document.documentElement.style.setProperty('--diele-accent', 'rgb(22, 163, 74)')

    expect(typeof resolveColor('diele-accent')).toBe('string')
    expect(resolveColor('diele-not-a-token')).not.toBeUndefined()
  })

  it('leaves nothing behind in the document after probing', () => {
    const before = document.body.childElementCount
    resolveColor('diele-accent')

    expect(document.body.childElementCount).toBe(before)
  })
})

// Specimens are fed to the real components rather than mimicked in markup, so this page cannot
// drift from what the portal actually renders.
describe('the specimens', () => {
  it('carries at least one of every row the page demonstrates', () => {
    expect(COMMANDS.length).toBeGreaterThan(0)
    expect(SITES.length).toBeGreaterThan(0)
    expect(ENTRY_ROWS.length).toBeGreaterThan(0)
    expect(ENTRY_ACTIONS.length).toBeGreaterThan(0)
    expect(SELECT_OPTIONS.length).toBeGreaterThan(0)
  })

  it('numbers the indexed specimens continuously, the way the launcher counts matches', () => {
    for (const list of [COMMANDS, SITES]) {
      expect(list.map((entry) => entry.index)).toEqual(list.map((_entry, index) => index))
    }
  })

  it('shapes each specimen as the component it is fed to expects', () => {
    for (const { item } of COMMANDS) {
      expect(item.kind).toBe('command')
      expect(item.url).toBe('')
      expect(typeof item.run).toBe('function')
    }

    for (const { item } of SITES) {
      expect(item.kind).toBe('suggestion')
    }

    expect(CARD.kind).toBe('card')
    expect(CARD.icon).not.toBe('')
    expect(FEATURE.id).not.toBe('')
  })

  it('gives every specimen row and option a value of its own', () => {
    const refs = [...COMMANDS, ...SITES].map((entry) => entry.item.ref)
    expect(new Set(refs).size).toBe(refs.length)

    const ids = ENTRY_ROWS.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
