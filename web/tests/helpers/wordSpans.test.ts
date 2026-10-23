import { describe, expect, it } from 'vitest'
import { wordSpans } from '@/helpers/wordSpans'

/**
 * Reads the words a text splits into.
 * @param {string} text - Text to split
 * @returns {string[]} - The words, in order
 */
function words(text: string): string[] {
  return wordSpans(text).map((span) => text.slice(span.start, span.end))
}

describe('wordSpans', () => {
  it('splits on separators of every kind', () => {
    expect(words('example-group/web_ui.v2 final')).toEqual([
      'example',
      'group',
      'web',
      'ui',
      'v2',
      'final',
    ])
  })

  it('splits on camel humps', () => {
    expect(words('UptimeKuma')).toEqual(['Uptime', 'Kuma'])
    expect(words('myHTTPServer')).toEqual(['my', 'HTTPServer'])
  })

  it('keeps letters of any script inside their word', () => {
    expect(words('Nachrichten und Hintergründe')).toEqual(['Nachrichten', 'und', 'Hintergründe'])
  })

  it('reads a text without letters as no words', () => {
    expect(words('')).toEqual([])
    expect(words(' - / ')).toEqual([])
  })

  it('reports where each word sits', () => {
    expect(wordSpans('a-bc')).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 4 },
    ])
  })
})
