import { describe, expect, it } from 'vitest'
import { actionsFor } from '@/features/portal/launchActions'
import { dynamicSiteLink } from '@/features/portal/dynamicTarget'
import {
  isCard,
  isCommand,
  isRow,
  isSuggestion,
  partitionTargets,
} from '@/features/portal/launchTargets'
import type {
  CardTarget,
  CommandTarget,
  PortalTarget,
  RowTarget,
  SuggestionTarget,
} from '@/types/portal'

const card: CardTarget = {
  ref: 'card:1',
  kind: 'card',
  name: 'Grafana',
  url: 'https://grafana.example',
  icon: '',
  color: 'currentColor',
}
const row: RowTarget = { ref: 'row:1', kind: 'row', name: 'web', url: 'https://git.example/web' }
const suggestion: SuggestionTarget = {
  ref: 'site:1',
  kind: 'suggestion',
  name: 'Docs',
  url: 'https://docs.example',
}
const command: CommandTarget = {
  ref: 'cmd:1',
  kind: 'command',
  name: '/admin',
  url: '',
  hint: 'configure',
  run: () => {},
}

describe('the kind guards', () => {
  it('each recognises its own kind and nothing else', () => {
    const targets: ReadonlyArray<[PortalTarget, (t: PortalTarget) => boolean]> = [
      [card, isCard],
      [row, isRow],
      [suggestion, isSuggestion],
      [command, isCommand],
    ]

    for (const [own, guard] of targets) {
      for (const [other] of targets) {
        expect(guard(other)).toBe(other === own)
      }
    }
  })
})

describe('partitionTargets', () => {
  // The index is the position in the full match list, which is what the digit shortcuts count.
  it('groups by section while keeping each entry position in the whole list', () => {
    const sections = partitionTargets([command, suggestion, card, row])

    expect(sections.commands).toEqual([{ index: 0, item: command }])
    expect(sections.suggestions).toEqual([{ index: 1, item: suggestion }])
    expect(sections.cards).toEqual([{ index: 2, item: card }])
    expect(sections.rows).toEqual([{ index: 3, item: row }])
  })

  it('keeps the indices continuous across sections, not per section', () => {
    const sections = partitionTargets([card, row, card, row])

    expect(sections.cards.map((entry) => entry.index)).toEqual([0, 2])
    expect(sections.rows.map((entry) => entry.index)).toEqual([1, 3])
  })

  it('keeps the order within each section', () => {
    const second: CardTarget = { ...card, ref: 'card:2', name: 'Second' }
    const sections = partitionTargets([card, second])

    expect(sections.cards.map((entry) => entry.item.ref)).toEqual(['card:1', 'card:2'])
  })

  it('reads an empty list as four empty sections', () => {
    expect(partitionTargets([])).toEqual({ commands: [], suggestions: [], cards: [], rows: [] })
  })
})

describe('actionsFor', () => {
  // A target that names none offers only its own url, so the arrow keys have nothing to
  // switch between on one.
  it('falls back to the target own url', () => {
    expect(actionsFor(card)).toEqual([
      { label: '', title: 'Grafana', href: 'https://grafana.example' },
    ])
  })

  it('hands back the actions a target arrived with', () => {
    const actions = [
      { label: '', title: 'web', href: 'https://git.example/web' },
      { label: 'MRs', title: 'Merge requests', href: 'https://git.example/web/-/merge_requests' },
    ]

    expect(actionsFor({ ...row, actions })).toBe(actions)
  })

  it('falls back when the list is there but empty', () => {
    expect(actionsFor({ ...row, actions: [] })).toHaveLength(1)
  })
})

describe('dynamicSiteLink', () => {
  // A made-up target must never stand on the resting page, and must never match anything but
  // the term that produced it.
  it('is always search-only and carries no keywords', () => {
    const target = dynamicSiteLink({ name: 'Go to', url: 'https://x.test/', display: 'x.test' })

    expect(target.searchOnly).toBe(true)
    expect(target.keywords).toEqual([])
    expect(target.kind).toBe('suggestion')
  })

  // The only identity a target nothing stored has.
  it('derives its ref from the url', () => {
    expect(dynamicSiteLink({ name: 'n', url: 'https://x.test/', display: 'd' }).ref).toBe(
      'adhoc:https://x.test/',
    )
  })

  it('carries adHoc only when asked for', () => {
    expect(dynamicSiteLink({ name: 'n', url: 'u', display: 'd' }).adHoc).toBeUndefined()
    expect(dynamicSiteLink({ name: 'n', url: 'u', display: 'd', adHoc: true }).adHoc).toBe(true)
  })
})
