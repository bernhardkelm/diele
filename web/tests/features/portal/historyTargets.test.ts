import { describe, expect, it } from 'vitest'
import { historyTargets, toHistoryTarget } from '@/features/portal/historyTargets'
import type { ApiHistoryEntry } from '@diele/common'
import type { CardTarget, RowTarget } from '@/types/portal'

/**
 * Builds a visited page as the api serves it.
 * @param {number} id - Entry id
 * @param {string} url - Origin and path it was kept as
 * @param {string} [title] - The page's own title
 * @returns {ApiHistoryEntry} - The entry
 */
function entry(id: number, url: string, title?: string): ApiHistoryEntry {
  return { id, url, ...(title ? { title } : {}), visits: 1, lastVisitedAt: '2026-10-01T00:00:00Z' }
}

const card: CardTarget = {
  ref: 'card:1',
  kind: 'card',
  name: 'Grafana',
  url: 'https://grafana.example/',
  icon: '',
  color: 'currentColor',
}

const repo: RowTarget = {
  ref: 'gitlab:1:1',
  kind: 'row',
  name: 'web',
  url: 'https://gitlab.example/group/web',
  actions: [
    { label: '', title: 'web', href: 'https://gitlab.example/group/web' },
    { label: 'ci', title: 'Pipelines', href: 'https://gitlab.example/group/web/-/pipelines' },
  ],
}

describe('toHistoryTarget', () => {
  it('reads as its title, with the address beside it', () => {
    const target = toHistoryTarget(entry(1, 'https://github.com/example/diele', 'diele'))

    expect(target).toMatchObject({
      ref: 'history:1',
      kind: 'history',
      name: 'diele',
      title: 'diele',
      display: 'github.com/example/diele',
      searchOnly: true,
    })
  })

  // Most visits opened through the bar arrive without one, and an empty name would be a blank row.
  it('falls back to the address where the page reported no title', () => {
    const target = toHistoryTarget(entry(2, 'https://www.example.com/'))

    expect(target.name).toBe('example.com')
    expect(target.title).toBeUndefined()
  })
})

describe('historyTargets', () => {
  it('turns every page into a target, in the order served', () => {
    const found = historyTargets(
      [entry(1, 'https://a.example/x'), entry(2, 'https://b.example/y')],
      [],
    )

    expect(found.map((target) => target.ref)).toEqual(['history:1', 'history:2'])
  })

  // The api's own dedupe compares exactly, so these are the near misses it can let through.
  it('leaves out a page a card already reaches, slash, www or query aside', () => {
    const found = historyTargets(
      [
        entry(1, 'https://grafana.example'),
        entry(2, 'https://www.grafana.example/'),
        entry(3, 'https://grafana.example/d/other'),
      ],
      [card],
    )

    expect(found.map((target) => target.ref)).toEqual(['history:3'])
  })

  it('counts every action of a known target, not only its own url', () => {
    const found = historyTargets(
      [entry(1, 'https://gitlab.example/group/web/-/pipelines/'), entry(2, 'https://x.example')],
      [repo],
    )

    expect(found.map((target) => target.ref)).toEqual(['history:2'])
  })

  // The url becomes the row's href, where anything but a web page would run rather than navigate.
  it('leaves out an entry that is not an http or https page', () => {
    const found = historyTargets(
      [
        entry(1, 'javascript:alert(1)'),
        entry(2, 'data:text/html,hi'),
        entry(3, 'not a url'),
        entry(4, 'http://localhost:3000/'),
      ],
      [],
    )

    expect(found.map((target) => target.ref)).toEqual(['history:4'])
  })

  it('answers nothing when nothing was visited', () => {
    expect(historyTargets([], [card, repo])).toEqual([])
  })
})
