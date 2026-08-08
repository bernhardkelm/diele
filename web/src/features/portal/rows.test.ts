import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandRow from '@/features/portal/CommandRow.vue'
import EntryRow from '@/features/portal/EntryRow.vue'
import ServiceCard from '@/features/portal/ServiceCard.vue'
import SiteRow from '@/features/portal/SiteRow.vue'
import StatusDot from '@/components/StatusDot.vue'
import type { CardTarget, CommandTarget, RowTarget, SuggestionTarget } from '@/types/portal'

const entry: RowTarget = {
  ref: 'gitlab:1:2',
  kind: 'row',
  name: 'web',
  url: 'https://gitlab.example/example-group/web',
  detail: 'example-group',
  timestamp: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
}

const site: SuggestionTarget = {
  ref: 'site:1',
  kind: 'suggestion',
  name: 'Docs',
  url: 'https://www.docs.example.com/guide',
}

const command: CommandTarget = {
  ref: 'cmd:1',
  kind: 'command',
  name: '/admin',
  url: '',
  hint: 'configure the portal',
  run: () => {},
}

const card: CardTarget = {
  ref: 'card:1',
  kind: 'card',
  name: 'Grafana',
  url: 'https://grafana.example',
  icon: '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>',
  color: '#1E88E5',
}

describe('EntryRow', () => {
  it('renders the namespace and the name, and links to the entry', () => {
    const wrapper = mount(EntryRow, { props: { entry } })

    expect(wrapper.text()).toContain('example-group')
    expect(wrapper.text()).toContain('web')
    expect(wrapper.find('a.row__main').attributes('href')).toBe(entry.url)
  })

  it('leaves out the namespace on a row that carries none', () => {
    const { detail: _detail, ...bare } = entry
    const wrapper = mount(EntryRow, { props: { entry: bare as RowTarget } })

    expect(wrapper.find('.row__namespace').exists()).toBe(false)
  })

  it('reports the last activity in relative time', () => {
    expect(mount(EntryRow, { props: { entry } }).find('.row__activity').text()).toBe('3d ago')
  })

  it('leaves the activity column empty when the row carries no timestamp', () => {
    const { timestamp: _timestamp, ...bare } = entry

    expect(
      mount(EntryRow, { props: { entry: bare as RowTarget } })
        .find('.row__activity')
        .text(),
    ).toBe('')
  })

  // Index 0 is the row's own link, which the main anchor already renders.
  it('renders the quick links beside the row, not the default one twice', () => {
    const actions = [
      { label: '', title: 'web', href: entry.url },
      { label: 'MRs', title: 'Merge requests', href: 'https://gitlab.example/mrs' },
      { label: 'CI', title: 'Pipelines', href: 'https://gitlab.example/ci' },
    ]
    const wrapper = mount(EntryRow, { props: { entry: { ...entry, actions } } })
    const links = wrapper.findAll('.row__link')

    expect(links).toHaveLength(2)
    expect(links.map((link) => link.text())).toEqual(['MRs', 'CI'])
    expect(links[0]!.attributes('aria-label')).toBe('web: Merge requests')
  })

  it('marks the row and the selected quick link while the highlight sits on it', () => {
    const actions = [
      { label: '', title: 'web', href: entry.url },
      { label: 'MRs', title: 'Merge requests', href: 'https://gitlab.example/mrs' },
    ]
    const wrapper = mount(EntryRow, {
      props: { entry: { ...entry, actions }, active: true, activeAction: 1 },
    })

    expect(wrapper.classes()).toContain('row--active')
    expect(wrapper.classes()).toContain('row--link-selected')
    expect(wrapper.find('.row__link').classes()).toContain('row__link--active')
  })

  it('reports a launch from the row and from a quick link alike', async () => {
    const actions = [
      { label: '', title: 'web', href: entry.url },
      { label: 'MRs', title: 'Merge requests', href: 'https://gitlab.example/mrs' },
    ]
    const wrapper = mount(EntryRow, { props: { entry: { ...entry, actions } } })

    await wrapper.find('.row__main').trigger('click')
    await wrapper.find('.row__link').trigger('click')

    expect(wrapper.emitted('launch')).toHaveLength(2)
  })
})

describe('SiteRow', () => {
  it('shows the host when the site names no detail, without the www nobody types', () => {
    expect(mount(SiteRow, { props: { site } }).find('.site__host').text()).toBe('docs.example.com')
  })

  it('prefers the detail the site carries', () => {
    const wrapper = mount(SiteRow, { props: { site: { ...site, display: 'the handbook' } } })

    expect(wrapper.find('.site__host').text()).toBe('the handbook')
  })

  it('falls back to the raw url when it will not parse', () => {
    const wrapper = mount(SiteRow, { props: { site: { ...site, url: 'not a url' } } })

    expect(wrapper.find('.site__host').text()).toBe('not a url')
  })

  // Only ever set for localhost entries, where something actually answered.
  it('shows a dot only while a local server is answering', () => {
    expect(mount(SiteRow, { props: { site } }).findComponent(StatusDot).exists()).toBe(false)
    expect(
      mount(SiteRow, { props: { site, live: true } })
        .findComponent(StatusDot)
        .exists(),
    ).toBe(true)
  })

  // A saved site replaces the portal, the way a typed url would.
  it('opens in place rather than in a new tab', () => {
    const link = mount(SiteRow, { props: { site } }).find('a')

    expect(link.attributes('target')).toBeUndefined()
    expect(link.attributes('rel')).toBe('noopener')
  })

  it('reports a launch when clicked', async () => {
    const wrapper = mount(SiteRow, { props: { site } })
    await wrapper.find('a').trigger('click')

    expect(wrapper.emitted('launch')).toHaveLength(1)
  })
})

describe('CommandRow', () => {
  it('renders the entry and its hint', () => {
    const wrapper = mount(CommandRow, { props: { command } })

    expect(wrapper.text()).toContain('/admin')
    expect(wrapper.find('.command__hint').text()).toBe('configure the portal')
  })

  // A command runs rather than navigating, so it is a button and not a link.
  it('is a button rather than a link', () => {
    const wrapper = mount(CommandRow, { props: { command } })

    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.find('button').attributes('type')).toBe('button')
  })

  it('reports a run when clicked', async () => {
    const wrapper = mount(CommandRow, { props: { command } })
    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('run')).toHaveLength(1)
  })

  it('marks the row while the highlight sits on it', () => {
    expect(mount(CommandRow, { props: { command, active: true } }).classes()).toContain(
      'command--active',
    )
    expect(mount(CommandRow, { props: { command } }).classes()).not.toContain('command--active')
  })
})

describe('ServiceCard', () => {
  it('renders the name and links to the service', () => {
    const wrapper = mount(ServiceCard, { props: { service: card } })

    expect(wrapper.text()).toContain('Grafana')
    expect(wrapper.attributes('href')).toBe('https://grafana.example')
  })

  // The markup was sanitised on the way into the database, so it is inlined as it comes.
  it('inlines the icon markup', () => {
    const wrapper = mount(ServiceCard, { props: { service: card } })

    expect(wrapper.find('.card__icon svg').exists()).toBe(true)
  })

  it('carries the brand accent as a custom property rather than a literal', () => {
    const wrapper = mount(ServiceCard, { props: { service: card } })

    expect(wrapper.attributes('style')).toContain('--service-color: #1E88E5')
  })

  // Omitted past the tenth card, since there is no digit left to press.
  it('shows a digit only when one was given', () => {
    expect(
      mount(ServiceCard, { props: { service: card } })
        .find('.card__shortcut')
        .exists(),
    ).toBe(false)
    expect(
      mount(ServiceCard, { props: { service: card, shortcut: '3' } })
        .find('.card__shortcut')
        .text(),
    ).toBe('3')
  })

  // Omitted for unmonitored cards and whenever Kuma is unreachable.
  it('shows a dot only where there is a status to show', () => {
    expect(
      mount(ServiceCard, { props: { service: card } })
        .findComponent(StatusDot)
        .exists(),
    ).toBe(false)

    const watched = mount(ServiceCard, { props: { service: card, status: { state: 'up' } } })
    expect(watched.findComponent(StatusDot).exists()).toBe(true)
  })

  it('reports a launch when clicked', async () => {
    const wrapper = mount(ServiceCard, { props: { service: card } })
    await wrapper.trigger('click')

    expect(wrapper.emitted('launch')).toHaveLength(1)
  })
})

// Every row marks what the term matched, so the reason a result is on screen is visible.
it('marks the term in every row that renders a name', () => {
  const rows = [
    mount(EntryRow, { props: { entry, query: 'web' } }),
    mount(SiteRow, { props: { site, query: 'docs' } }),
    mount(CommandRow, { props: { command, query: 'admin' } }),
    mount(ServiceCard, { props: { service: card, query: 'graf' } }),
  ]

  for (const wrapper of rows) {
    expect(wrapper.find('mark').exists()).toBe(true)
  }
})
