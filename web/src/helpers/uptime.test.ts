import { describe, expect, it } from 'vitest'
import { mapServiceStatus, type KumaHeartbeats, type KumaSummary } from '@/helpers/uptime'
import type { CardTarget } from '@/types/portal'

/**
 * Builds a card to resolve a monitor for.
 * @param {string} name - Card name
 * @param {string} url - Card url
 * @returns {CardTarget} - The card
 */
function card(name: string, url: string): CardTarget {
  return { ref: `card:${name}`, kind: 'card', name, url, icon: '', color: 'currentColor' }
}

const summary: KumaSummary = {
  publicGroupList: [
    {
      monitorList: [
        { id: 1, name: 'Grafana', url: 'https://grafana.example.com' },
        { id: 2, name: 'prometheus.example.com' },
        { id: 3, name: 'Uptime Kuma' },
      ],
    },
  ],
}

const heartbeats: KumaHeartbeats = {
  heartbeatList: {
    '1': [{ status: 0 }, { status: 1 }],
    '2': [{ status: 0 }],
    '3': [{ status: 2 }],
  },
  uptimeList: { '1_24': 0.997, '2_24': 0.5 },
}

describe('matching a card to a monitor', () => {
  it('matches on the monitor url', () => {
    const statuses = mapServiceStatus(
      [card('Anything', 'https://grafana.example.com')],
      summary,
      heartbeats,
    )

    expect(statuses.get('card:Anything')?.state).toBe('up')
  })

  // Kuma only reports a monitor url when the status page has "Show URL" enabled, so the name
  // lookup is what keeps matching working without it.
  it('matches a monitor named after the host when no url is reported', () => {
    const statuses = mapServiceStatus(
      [card('Metrics', 'https://prometheus.example.com')],
      summary,
      heartbeats,
    )

    expect(statuses.get('card:Metrics')?.state).toBe('down')
  })

  it('falls back to the card display name', () => {
    const statuses = mapServiceStatus(
      [card('Uptime Kuma', 'https://kuma.internal')],
      summary,
      heartbeats,
    )

    expect(statuses.get('card:Uptime Kuma')?.state).toBe('pending')
  })

  it('matches the host case-insensitively', () => {
    const statuses = mapServiceStatus(
      [card('X', 'https://GRAFANA.example.com')],
      summary,
      heartbeats,
    )

    expect(statuses.get('card:X')?.state).toBe('up')
  })
})

describe('cards that render no dot', () => {
  it('leaves out a card with no monitor', () => {
    expect(
      mapServiceStatus([card('Unwatched', 'https://nope.example')], summary, heartbeats).size,
    ).toBe(0)
  })

  it('leaves out a monitor with no heartbeat', () => {
    const statuses = mapServiceStatus([card('Grafana', 'https://grafana.example.com')], summary, {
      heartbeatList: {},
    })

    expect(statuses.size).toBe(0)
  })

  it('leaves out a heartbeat carrying no status', () => {
    const statuses = mapServiceStatus([card('Grafana', 'https://grafana.example.com')], summary, {
      heartbeatList: { '1': [{}] },
    })

    expect(statuses.size).toBe(0)
  })

  // Anything outside Kuma's four codes is unknown, which drops the dot rather than guessing.
  it('leaves out a status code Kuma does not define', () => {
    const statuses = mapServiceStatus([card('Grafana', 'https://grafana.example.com')], summary, {
      heartbeatList: { '1': [{ status: 9 }] },
    })

    expect(statuses.size).toBe(0)
  })

  it('leaves out a card whose url will not parse, unless its name matches', () => {
    expect(mapServiceStatus([card('Broken', 'not a url')], summary, heartbeats).size).toBe(0)
    expect(mapServiceStatus([card('Uptime Kuma', 'not a url')], summary, heartbeats).size).toBe(1)
  })

  it('copes with an empty summary and an empty heartbeat payload', () => {
    expect(mapServiceStatus([card('Grafana', 'https://grafana.example.com')], {}, {}).size).toBe(0)
  })
})

describe('what the dot carries', () => {
  // The last beat is the current state; the ones before it are history.
  it('reads the state from the most recent beat', () => {
    const statuses = mapServiceStatus(
      [card('Grafana', 'https://grafana.example.com')],
      summary,
      heartbeats,
    )

    expect(statuses.get('card:Grafana')?.state).toBe('up')
  })

  it('carries the 24 hour uptime when Kuma reports one', () => {
    const statuses = mapServiceStatus(
      [card('Grafana', 'https://grafana.example.com')],
      summary,
      heartbeats,
    )

    expect(statuses.get('card:Grafana')?.uptime).toBe(0.997)
  })

  it('leaves the uptime undefined when Kuma reports none', () => {
    const statuses = mapServiceStatus(
      [card('Uptime Kuma', 'https://kuma.internal')],
      summary,
      heartbeats,
    )

    expect(statuses.get('card:Uptime Kuma')?.uptime).toBeUndefined()
  })

  it('maps every state Kuma defines', () => {
    const beats: KumaHeartbeats = {
      heartbeatList: { '1': [{ status: 0 }], '2': [{ status: 1 }], '3': [{ status: 3 }] },
    }

    const statuses = mapServiceStatus(
      [
        card('Grafana', 'https://grafana.example.com'),
        card('Metrics', 'https://prometheus.example.com'),
        card('Uptime Kuma', 'https://kuma.internal'),
      ],
      summary,
      beats,
    )

    expect(statuses.get('card:Grafana')?.state).toBe('down')
    expect(statuses.get('card:Metrics')?.state).toBe('up')
    expect(statuses.get('card:Uptime Kuma')?.state).toBe('maintenance')
  })
})

it('ignores a monitor with no id, since nothing can be looked up by it', () => {
  const statuses = mapServiceStatus(
    [card('Nameless', 'https://nameless.example')],
    { publicGroupList: [{ monitorList: [{ name: 'Nameless', url: 'https://nameless.example' }] }] },
    { heartbeatList: { undefined: [{ status: 1 }] } },
  )

  expect(statuses.size).toBe(0)
})
