import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { usePortalLauncher, type PortalLauncher } from '@/features/portal/usePortalLauncher'
import { withSetup } from '@/testing/withSetup'
import type { ApiCommand } from '@diele/common'
import type { CardTarget, PortalTarget, SuggestionTarget } from '@/types/portal'

const card: CardTarget = {
  ref: 'card:1',
  kind: 'card',
  name: 'Grafana',
  url: 'https://grafana.example',
  icon: '',
  color: 'currentColor',
}

const savedSite: SuggestionTarget = {
  ref: 'site:1',
  kind: 'suggestion',
  name: 'Handbook',
  url: 'https://docs.example',
  searchOnly: true,
}

const command: ApiCommand = {
  id: 1,
  ref: 'cmd:1',
  keyword: 'yt',
  label: 'YouTube',
  urlTemplate: 'https://youtube.test/results?q={query}',
  position: 1000,
}

const assign = vi.fn()
const open = vi.fn()
const openAdmin = vi.fn()
const openSettings = vi.fn()
const signOut = vi.fn()

/**
 * Mounts the portal launcher with whatever the test needs on top of a working portal.
 * @param {object} overrides - Portal state to vary
 * @returns {{ result: PortalLauncher }} - The launcher
 */
function launcher(
  overrides: {
    targets?: ReadonlyArray<PortalTarget>
    commands?: ReadonlyArray<ApiCommand>
    redditEnabled?: boolean
    offersAdmin?: boolean
    userName?: string | null
  } = {},
): { result: PortalLauncher } {
  return withSetup(() =>
    usePortalLauncher({
      targets: computed(() => overrides.targets ?? [card, savedSite]),
      slashCommands: computed(() => overrides.commands ?? [command]),
      redditEnabled: computed(() => overrides.redditEnabled ?? true),
      offersAdmin: computed(() => overrides.offersAdmin ?? true),
      userName: computed(() => overrides.userName ?? 'Ada'),
      tileColumns: ref(3),
      enabled: () => true,
      urlFor: (term) => `https://search.test/?q=${encodeURIComponent(term)}`,
      openAdmin,
      openSettings,
      signOut,
    }),
  )
}

beforeEach(() => {
  localStorage.clear()
  assign.mockClear()
  open.mockClear()
  openAdmin.mockClear()
  openSettings.mockClear()
  signOut.mockClear()
  vi.stubGlobal('open', open)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign, href: 'http://portal.test/', pathname: '/', search: '', hash: '' },
  })
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('what the term adds to the list', () => {
  it('shows only the resting entries while nothing is typed', () => {
    const { result } = launcher()

    expect(result.isSearching.value).toBe(false)
    expect(result.matches.value.map((target) => target.ref)).toEqual(['card:1'])
  })

  it('offers a saved site once the term matches it', async () => {
    const { result } = launcher()

    result.query.value = 'handbook'
    await nextTick()

    expect(result.matches.value.map((target) => target.ref)).toContain('site:1')
    expect(result.isSearching.value).toBe(true)
  })

  it('offers a go-to entry for a term that is really a url', async () => {
    const { result } = launcher()

    result.query.value = 'example.com'
    await nextTick()

    expect(result.matches.value[0]?.url).toBe('https://example.com/')
  })

  it('offers a subreddit jump while the portal setting allows it', async () => {
    const { result } = launcher()

    result.query.value = 'r/vuejs'
    await nextTick()

    expect(result.matches.value[0]?.url).toBe('https://www.reddit.com/r/vuejs/')
  })

  it('offers no subreddit jump once the setting is off', async () => {
    const { result } = launcher({ redditEnabled: false })

    result.query.value = 'r/vuejs'
    await nextTick()

    expect(result.matches.value.some((target) => target.url.includes('reddit.com'))).toBe(false)
  })

  it('offers the slash menu for a bare slash', async () => {
    const { result } = launcher()

    result.query.value = '/'
    await nextTick()

    const names = result.sections.value.commands.map((entry) => entry.item.name)
    expect(names).toContain('/admin')
    expect(names).toContain('/settings')
    expect(names).toContain('/yt')
  })

  it('leaves the admin entry out for an account that may not configure', async () => {
    const { result } = launcher({ offersAdmin: false })

    result.query.value = '/'
    await nextTick()

    expect(result.sections.value.commands.map((entry) => entry.item.name)).not.toContain('/admin')
  })

  // The term after the keyword is what marks up a command row, rather than the whole line
  // including the keyword itself.
  it('reports the term after a slash keyword on its own', async () => {
    const { result } = launcher()

    result.query.value = '/yt vue router'
    await nextTick()

    expect(result.commandQuery.value).toBe('vue router')
  })

  it('reports an empty command term for anything that is not a slash command', async () => {
    const { result } = launcher()

    result.query.value = 'grafana'
    await nextTick()

    expect(result.commandQuery.value).toBe('')
  })
})

describe('the sections the page renders', () => {
  it('splits the matches into the lists that draw them', async () => {
    const { result } = launcher()

    result.query.value = '/'
    await nextTick()

    expect(result.sections.value.commands.length).toBeGreaterThan(0)
    expect(result.sections.value.cards).toEqual([])
  })

  it('counts positions across every section, so the digit badges stay continuous', () => {
    const second: CardTarget = { ...card, ref: 'card:2', name: 'Kuma' }
    const { result } = launcher({ targets: [card, second] })

    expect(result.sections.value.cards.map((entry) => entry.index)).toEqual([0, 1])
  })
})

describe('submitting', () => {
  // A term the portal already knows beats handing it to a search engine.
  it('opens the highlighted match', async () => {
    const { result } = launcher()

    result.query.value = 'grafana'
    await nextTick()
    result.submit(false)

    expect(assign).toHaveBeenCalledWith('https://grafana.example')
  })

  it('searches the term when nothing is highlighted', () => {
    const { result } = launcher()

    result.query.value = 'nothing matches this'
    result.submit(false)

    expect(assign).toHaveBeenCalledWith('https://search.test/?q=nothing%20matches%20this')
  })

  it('opens alongside when a modifier was held', async () => {
    const { result } = launcher()

    result.query.value = 'grafana'
    await nextTick()
    result.submit(true)

    expect(open).toHaveBeenCalledWith('https://grafana.example', '_blank', 'noopener')
  })

  it('does nothing on an empty field', () => {
    const { result } = launcher()

    result.submit(false)

    expect(assign).not.toHaveBeenCalled()
  })
})

describe('running a command', () => {
  it('runs the built-in the entry stands for', async () => {
    const { result } = launcher()

    result.query.value = '/settings'
    await nextTick()

    const settings = result.sections.value.commands.find(
      (entry) => entry.item.name === '/settings',
    )!
    result.runCommand(settings.item)

    expect(openSettings).toHaveBeenCalled()
  })

  it('ends the session from the logout entry', async () => {
    const { result } = launcher()

    result.query.value = '/logout'
    await nextTick()

    result.runCommand(result.sections.value.commands[0]!.item)

    expect(signOut).toHaveBeenCalled()
  })

  // An entry whose job is to lead to others types its keyword into the field rather than
  // clearing it.
  it('keeps the field on an entry that prefills it', async () => {
    const { result } = launcher()

    result.query.value = '/yt'
    await nextTick()

    const menu = result.sections.value.commands.find((entry) => entry.item.name === '/yt')!
    result.runCommand(menu.item)
    await nextTick()

    expect(result.query.value).toBe('/yt ')
  })
})

describe('what the selection announces', () => {
  it('names the highlighted match', async () => {
    const { result } = launcher()

    result.query.value = 'grafana'
    await nextTick()

    expect(result.activeName.value).toContain('Grafana')
  })

  it('names nothing while nothing is selected', () => {
    const { result } = launcher()

    expect(result.activeName.value).toBeUndefined()
    expect(result.hasSelection.value).toBe(false)
  })
})

// Every launch feeds the ranking; one that came from a typed url also lands in the visited
// list, whose hosts can later be lifted into the saved sites.
describe('recording a launch', () => {
  it('remembers what was opened', () => {
    const { result } = launcher()

    result.recordLaunch(card)

    expect(localStorage.getItem('diele:launch-history:v2')).toContain('card:1')
  })

  it('records the host only for a target built from a typed url', () => {
    const { result } = launcher()

    result.recordLaunch(savedSite)
    expect(localStorage.getItem('diele:visited-urls')).toBeNull()

    result.recordLaunch({
      ...savedSite,
      ref: 'adhoc:x',
      adHoc: true,
      url: 'https://typed.example/x',
    })
    expect(localStorage.getItem('diele:visited-urls')).toContain('https://typed.example')
  })
})
