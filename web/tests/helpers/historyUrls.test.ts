import { describe, expect, it } from 'vitest'
import { comparableHref, domainFrom, isExcludedHost, isWebUrl } from '@/helpers/historyUrls'

describe('comparableHref', () => {
  it('reads two spellings of one page as the same', () => {
    expect(comparableHref('https://www.Example.com/docs/')).toBe(
      comparableHref('https://example.com/docs?tab=1#top'),
    )
  })

  it('keeps the scheme and the port apart', () => {
    expect(comparableHref('http://example.com/')).not.toBe(comparableHref('https://example.com/'))
    expect(comparableHref('http://localhost:3000')).not.toBe(
      comparableHref('http://localhost:5173'),
    )
  })

  it('answers nothing for a url it cannot parse', () => {
    expect(comparableHref('not a url')).toBe('')
  })
})

describe('isExcludedHost', () => {
  it('covers the domain and everything below it', () => {
    expect(isExcludedHost('https://bank.example/login', ['bank.example'])).toBe(true)
    expect(isExcludedHost('https://www.bank.example/', ['bank.example'])).toBe(true)
  })

  // A suffix of the name is not a subdomain: excluding one bank must not exclude another.
  it('does not cover a host that merely ends in the same letters', () => {
    expect(isExcludedHost('https://notbank.example/', ['bank.example'])).toBe(false)
  })

  it('excludes nothing with no domains, or for a url it cannot parse', () => {
    expect(isExcludedHost('https://bank.example/', [])).toBe(false)
    expect(isExcludedHost('nonsense', ['bank.example'])).toBe(false)
  })
})

describe('domainFrom', () => {
  it('reads a bare host', () => {
    expect(domainFrom('  Example.COM ')).toBe('example.com')
  })

  // A whole address is the likelier thing on the clipboard than a bare host.
  it('reads the host out of a pasted address, without its www', () => {
    expect(domainFrom('https://www.bank.example/accounts?id=1')).toBe('bank.example')
  })

  it('takes localhost, which has no dot to look for', () => {
    expect(domainFrom('localhost:5173')).toBe('localhost')
  })

  it('refuses what is not a domain', () => {
    expect(domainFrom('')).toBeUndefined()
    expect(domainFrom('two words')).toBeUndefined()
    expect(domainFrom('nodot')).toBeUndefined()
    expect(domainFrom('-bad-.example')).toBeUndefined()
  })
})

describe('isWebUrl', () => {
  it('takes http and https alone', () => {
    expect(isWebUrl('https://example.com/')).toBe(true)
    expect(isWebUrl('http://localhost:3000')).toBe(true)
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
    expect(isWebUrl('file:///etc/hosts')).toBe(false)
    expect(isWebUrl('example.com')).toBe(false)
  })
})
