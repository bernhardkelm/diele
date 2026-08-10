import { describe, expect, it } from 'vitest'
import { fieldsFor } from '@/helpers/searchFields'
import type { CardTarget, CommandTarget, RowTarget, SuggestionTarget } from '@/types/portal'

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
