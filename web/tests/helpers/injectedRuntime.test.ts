import { afterEach, describe, expect, it } from 'vitest'
import { readInjectedBrand, readInjectedVersion } from '@/helpers/injectedRuntime'

const BRAND = {
  title: 'acme',
  subtitle: 'start page',
  accentLight: '#16a34a',
  accentDark: '#22c55e',
}

/**
 * Stamps a meta into the document the way the api does when it serves it.
 * @param {string} name - Meta name
 * @param {string} content - Its content
 * @returns {void}
 */
function stamp(name: string, content: string): void {
  const meta = document.createElement('meta')
  meta.name = name
  meta.content = content
  document.head.append(meta)
}

afterEach(() => {
  document.head.querySelectorAll('meta[name^="diele:"]').forEach((meta) => meta.remove())
})

describe('the brand', () => {
  it('is read back as it was stamped', () => {
    stamp('diele:brand', JSON.stringify(BRAND))

    expect(readInjectedBrand()).toEqual(BRAND)
  })

  // The dev server serves index.html itself, so nothing stamps it there, and the app falls back
  // to the defaults exactly as it did before.
  it('is undefined when the document carries none', () => {
    expect(readInjectedBrand()).toBeUndefined()
  })

  it('is undefined rather than a throw when the content is not json', () => {
    stamp('diele:brand', '{not json')

    expect(readInjectedBrand()).toBeUndefined()
  })

  // Painting a header from a payload missing the two strings it renders would put `undefined`
  // on screen, which is worse than the default it replaced.
  it('is undefined when the wordmark or its subtitle is missing', () => {
    stamp('diele:brand', JSON.stringify({ ...BRAND, subtitle: undefined }))

    expect(readInjectedBrand()).toBeUndefined()
  })
})

describe('the version', () => {
  it('is read back as it was stamped', () => {
    stamp('diele:version', '1.2.3')

    expect(readInjectedVersion()).toBe('1.2.3')
  })

  it('is undefined when the document carries none, so the footer names nothing', () => {
    expect(readInjectedVersion()).toBeUndefined()
  })

  it('is undefined when it was stamped empty', () => {
    stamp('diele:version', '')

    expect(readInjectedVersion()).toBeUndefined()
  })
})
