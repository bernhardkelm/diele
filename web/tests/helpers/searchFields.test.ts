import { describe, expect, it } from 'vitest'
import { fieldsFor, siteNameOf } from '@/helpers/searchFields'
import type {
  CardTarget,
  CommandTarget,
  HistoryTarget,
  RowTarget,
  SuggestionTarget,
} from '@/types/portal'

/**
 * Reads the texts a target is searched over, dropping the weights.
 * @param {ReadonlyArray<{ text: string }>} fields - Weighted fields
 * @returns {string[]} - Just the texts, in order
 */
function texts(fields: ReadonlyArray<{ text: string }>): string[] {
  return fields.map((field) => field.text)
}

const card: CardTarget = {
  ref: 'card:1',
  kind: 'card',
  name: 'Grafana',
  url: 'https://grafana.example.com',
  icon: '',
  color: 'currentColor',
}

const row: RowTarget = {
  ref: 'gitlab:1:2',
  kind: 'row',
  name: 'web',
  url: 'https://gitlab.com/example-group/web',
  detail: 'example-group',
}

const suggestion: SuggestionTarget = {
  ref: 'site:1',
  kind: 'suggestion',
  name: 'Docs',
  url: 'https://www.docs.example.com/guide',
  display: 'the handbook',
}

const command: CommandTarget = {
  ref: 'cmd:1',
  kind: 'command',
  name: 'admin',
  url: '',
  hint: 'Open the admin panel',
  run: () => {},
}

describe('fieldsFor', () => {
  it('always leads with the name, weighted highest', () => {
    for (const target of [card, row, suggestion, command]) {
      const fields = fieldsFor(target)

      expect(fields[0]!.text).toBe(target.name)
      expect(fields[0]!.weight).toBe(1)
    }
  })

  // Every repo sits on the same host, so only the namespace says which one this is.
  it('searches a row over its namespace', () => {
    expect(texts(fieldsFor(row))).toContain('example-group')
  })

  it('searches a command over its hint and a suggestion over its detail', () => {
    expect(texts(fieldsFor(command))).toContain('Open the admin panel')
    expect(texts(fieldsFor(suggestion))).toContain('the handbook')
  })

  it('carries keywords, skipping the empty ones', () => {
    const fields = fieldsFor({ ...card, keywords: ['metrics', '', 'dashboards'] })

    expect(texts(fields)).toContain('metrics')
    expect(texts(fields)).toContain('dashboards')
    expect(texts(fields)).not.toContain('')
  })

  // A term hitting a shared domain would otherwise raise every card or every repo at once.
  it('only searches a suggestion by its host', () => {
    expect(texts(fieldsFor(suggestion))).toContain('docs.example.com')
    expect(texts(fieldsFor(card))).not.toContain('grafana.example.com')
    expect(texts(fieldsFor(row))).not.toContain('gitlab.com')
  })

  it('drops the www nobody types', () => {
    expect(texts(fieldsFor(suggestion))).not.toContain('www.docs.example.com')
  })

  it('weights the host under everything else, so a domain hit sorts last', () => {
    const host = fieldsFor(suggestion).find((field) => field.text === 'docs.example.com')!
    const others = fieldsFor(suggestion).filter((field) => field.text !== 'docs.example.com')

    for (const field of others) {
      expect(field.weight).toBeGreaterThan(host.weight)
    }
  })

  it('leaves out a host it cannot parse rather than adding an empty field', () => {
    expect(texts(fieldsFor({ ...suggestion, url: 'not a url' }))).not.toContain('')
  })

  it('leaves out an absent detail rather than adding an empty field', () => {
    const { detail: _detail, ...bare } = row

    expect(texts(fieldsFor(bare as RowTarget))).toEqual(['web'])
  })
})

describe('siteNameOf', () => {
  it('reads the host without its www and its last label', () => {
    expect(siteNameOf('https://www.heise.de/')).toBe('heise')
    expect(siteNameOf('https://www.nytimes.com/section/world')).toBe('nytimes')
    expect(siteNameOf('https://gist.github.com/x')).toBe('gist.github')
  })

  // A plain rule rather than a list of public suffixes: the first label still holds the name.
  it('keeps the first label of a two-label suffix', () => {
    expect(siteNameOf('https://www.bbc.co.uk/news')).toBe('bbc.co')
  })

  it('keeps a single label and an address whole', () => {
    expect(siteNameOf('http://localhost:3000/')).toBe('localhost')
    expect(siteNameOf('http://192.168.1.10/')).toBe('192.168.1.10')
    expect(siteNameOf('http://[::1]:8080/')).toBe('[::1]')
  })

  it('reads an unparseable url as no name', () => {
    expect(siteNameOf('not a url')).toBe('')
  })
})

describe('the fields of a visited page', () => {
  const page: HistoryTarget = {
    ref: 'history:1',
    kind: 'history',
    name: 'heise online - IT-News, Nachrichten und Hintergründe | heise online',
    title: 'heise online - IT-News, Nachrichten und Hintergründe | heise online',
    url: 'https://www.heise.de/news/some-article.html',
    display: 'heise.de/news/some-article.html',
    searchOnly: true,
  }

  // What someone types to find a site again is its name, not the page's title or its path.
  it('leads with the site name, then the title, the host and the path', () => {
    const fields = fieldsFor(page)

    expect(texts(fields)).toEqual(['heise', page.name, 'heise.de', 'news/some-article.html'])

    const weights = fields.map((field) => field.weight)
    expect(weights[0]).toBe(1)
    expect([...weights].sort((a, b) => b - a)).toEqual(weights)
    expect(new Set(weights).size).toBe(weights.length)
  })

  it('leaves out the path of a bare origin', () => {
    expect(texts(fieldsFor({ ...page, url: 'https://www.heise.de/' }))).toEqual([
      'heise',
      page.name,
      'heise.de',
    ])
  })
})
