import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readFreshEntry,
  readStored,
  readStringList,
  removeStored,
  writeJson,
  writeStored,
} from '@/helpers/storage'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('raw values', () => {
  it('round-trips a string and removes it', () => {
    writeStored('k', 'value')
    expect(readStored('k')).toBe('value')

    removeStored('k')
    expect(readStored('k')).toBeNull()
  })

  it('reads an absent key as null', () => {
    expect(readStored('missing')).toBeNull()
  })
})

// localStorage throws rather than degrading when it is disabled, full, or running in a private
// window. A failure costs the convenience and never the page.
describe('when localStorage refuses', () => {
  it('reads as absent rather than throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('disabled')
    })

    expect(readStored('k')).toBeNull()
    expect(readStringList('k')).toEqual([])
    expect(readFreshEntry('k', 1000)).toBeUndefined()
  })

  it('swallows a failed write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    expect(() => writeStored('k', 'value')).not.toThrow()
    expect(() => writeJson('k', { a: 1 })).not.toThrow()
  })

  it('swallows a failed removal', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('disabled')
    })

    expect(() => removeStored('k')).not.toThrow()
  })

  // A value that cannot be serialised is a bug rather than a storage failure, but it still
  // must not reach the caller.
  it('swallows a value that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(() => writeJson('k', cyclic)).not.toThrow()
  })
})

describe('json entries', () => {
  it('reads back what was written', () => {
    writeJson('k', { storedAt: Date.now(), payload: 'x' })

    expect(readFreshEntry('k', 60_000)?.payload).toBe('x')
  })

  // A half written or older-shaped entry is worth no more than none at all.
  it('reads unparseable content as absent', () => {
    writeStored('k', '{not json')

    expect(readFreshEntry('k', 60_000)).toBeUndefined()
    expect(readStringList('k')).toEqual([])
  })

  it('refuses an entry that is not an object, or carries no stamp', () => {
    writeJson('k', 'a string')
    expect(readFreshEntry('k', 60_000)).toBeUndefined()

    writeJson('k', { payload: 'x' })
    expect(readFreshEntry('k', 60_000)).toBeUndefined()

    writeJson('k', { storedAt: 'yesterday', payload: 'x' })
    expect(readFreshEntry('k', 60_000)).toBeUndefined()
  })

  it('drops an entry past its max age', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    writeJson('k', { storedAt: Date.now(), payload: 'x' })

    vi.setSystemTime(new Date('2026-01-01T00:00:59Z'))
    expect(readFreshEntry('k', 60_000)).toBeDefined()

    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'))
    expect(readFreshEntry('k', 60_000)).toBeUndefined()
  })
})

describe('string lists', () => {
  it('reads a stored list back', () => {
    writeJson('k', ['a', 'b'])

    expect(readStringList('k')).toEqual(['a', 'b'])
  })

  it('drops anything in it that is not a string', () => {
    writeJson('k', ['a', 1, null, { b: 2 }, 'c'])

    expect(readStringList('k')).toEqual(['a', 'c'])
  })

  it('reads a non-list as empty', () => {
    writeJson('k', { a: 1 })

    expect(readStringList('k')).toEqual([])
  })

  it('reads an absent key as empty', () => {
    expect(readStringList('missing')).toEqual([])
  })
})
