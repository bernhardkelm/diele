import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '@/App.vue'
import CommandRow from '@/features/portal/CommandRow.vue'
import EntryRow from '@/features/portal/EntryRow.vue'
import LauncherBar from '@/components/LauncherBar.vue'
import LoginGate from '@/views/LoginGate.vue'
import ServiceCard from '@/features/portal/ServiceCard.vue'
import SignedOutBanner from '@/features/portal/SignedOutBanner.vue'
import SiteRow from '@/features/portal/SiteRow.vue'
import { CONFIG_CACHE_KEY } from '@/config/api'
import { resetAdmin } from '@/features/admin/useAdmin'
import { resetPortalConfig } from '@/composables/usePortalConfig'
import { resetConnectorEntries } from '@/composables/useConnectorEntries'
import { resetSession, useSession } from '@/composables/useSession'
import { sessionLapsed } from '@/composables/sessionLapse'

const CONFIG = {
  brand: { title: 'diele', subtitle: 'start page', accentLight: '#16a34a', accentDark: '#22c55e' },
  cards: [
    {
      id: 1,
      ref: 'card:1',
      kind: 'card',
      label: 'Grafana',
      url: 'https://grafana.example',
      display: null,
      keywords: ['metrics'],
      icon: null,
      iconId: null,
      color: null,
      position: 1000,
    },
  ],
  sites: [
    {
      id: 2,
      ref: 'site:2',
      kind: 'site',
      label: 'Handbook',
      url: 'https://docs.example',
      display: null,
      keywords: [],
      icon: null,
      iconId: null,
      color: null,
      position: 1000,
    },
  ],
  engines: [
    {
      id: 5,
      ref: 'engine:5',
      name: 'DuckDuckGo',
      urlTemplate: 'https://d.test/?q={query}',
      position: 1000,
    },
  ],
  commands: [],
  localhost: [],
  settings: {},
}

const ENTRIES = {
  entries: [
    {
      ref: 'gitlab:1:1',
      connectorId: 1,
      connectorType: 'gitlab',
      kind: 'row',
      label: 'web',
      detail: 'example-group',
      url: 'https://gitlab.example/example-group/web',
      keywords: [],
      actions: [],
      timestamp: null,
      parentRef: null,
      searchOnly: false,
    },
  ],
  sources: [{ connectorId: 1, type: 'gitlab', label: 'work', syncedAt: null, error: null }],
  hidden: { all: [], mine: [] },
}

/**
 * Answers every endpoint the portal reads on a cold start.
 * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
 */
function stubApi() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input)

    if (url.includes('/api/config')) {
      return Promise.resolve(new Response(JSON.stringify(CONFIG), { headers: { etag: 'W/"1"' } }))
    }

    if (url.includes('/api/entries')) {
      return Promise.resolve(new Response(JSON.stringify(ENTRIES)))
    }

    if (url.includes('/api/auth/me')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ id: 1, name: 'Ada', email: null, picture: null, canAdmin: true }),
        ),
      )
    }

    if (url.includes('/api/auth/providers')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            brand: CONFIG.brand,
            mode: 'local',
            setupRequired: false,
            providers: [],
          }),
        ),
      )
    }

    return Promise.resolve(new Response(JSON.stringify({ ok: true })))
  })
}

/**
 * Mounts the portal and waits for the configuration to paint.
 * @returns {Promise<VueWrapper>} - The mounted portal
 */
async function open(): Promise<VueWrapper> {
  const wrapper = mount(App, { attachTo: document.body })
  await vi.waitFor(() => expect(wrapper.findComponent(ServiceCard).exists()).toBe(true))

  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
  resetPortalConfig()
  resetConnectorEntries()
  resetSession()
  resetAdmin()
  vi.stubGlobal('fetch', stubApi())
})

afterEach(() => {
  resetPortalConfig()
  resetConnectorEntries()
  resetSession()
  resetAdmin()
  localStorage.clear()
  window.location.hash = ''
  vi.unstubAllGlobals()
})

describe('the resting page', () => {
  it('paints the brand, the field and the cards', async () => {
    const wrapper = await open()

    expect(wrapper.find('h1').text()).toContain('diele')
    expect(wrapper.findComponent(LauncherBar).exists()).toBe(true)
    expect(wrapper.findComponent(ServiceCard).props('service').name).toBe('Grafana')
  })

  // The resting page is the portal itself, so search-only entries stay out of it.
  it('leaves saved sites and commands off it', async () => {
    const wrapper = await open()

    expect(wrapper.findComponent(SiteRow).exists()).toBe(false)
    expect(wrapper.findComponent(CommandRow).exists()).toBe(false)
  })

  it('shows the connector rows the API served', async () => {
    const wrapper = await open()
    await vi.waitFor(() => expect(wrapper.findComponent(EntryRow).exists()).toBe(true))

    expect(wrapper.findComponent(EntryRow).props('entry').name).toBe('web')
  })

  // For whoever opens the page and wonders what it is. Opened in its own tab, so following it
  // never costs the portal someone had in front of them.
  it('points at the docs for the thing it is running', async () => {
    const wrapper = await open()
    const link = wrapper.find('.page-footer a')

    expect(link.text()).toBe('docs')
    expect(link.attributes('href')).toBe('https://github.com/bernhardkelm/diele')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })
})

describe('searching', () => {
  it('offers a saved site once a term matches it', async () => {
    const wrapper = await open()

    await wrapper.find('input').setValue('handbook')
    await nextTick()

    expect(wrapper.findComponent(SiteRow).props('site').name).toBe('Handbook')
  })

  it('narrows the cards to what the term matches', async () => {
    const wrapper = await open()

    await wrapper.find('input').setValue('grafana')
    await nextTick()
    expect(wrapper.findAllComponents(ServiceCard)).toHaveLength(1)

    await wrapper.find('input').setValue('zzznothing')
    await nextTick()
    expect(wrapper.findAllComponents(ServiceCard)).toHaveLength(0)
  })

  // Enter would hand the term to the engine, so the page says which one rather than leaving it
  // to be found out by pressing it.
  it('says what a term with no matches would search', async () => {
    const wrapper = await open()

    await wrapper.find('input').setValue('zzznothing')
    await nextTick()

    expect(wrapper.find('.page__empty').text()).toContain('DuckDuckGo')
    expect(wrapper.find('.page__empty').text()).toContain('zzznothing')
  })

  it('offers the slash menu when the term is a slash', async () => {
    const wrapper = await open()

    await wrapper.find('input').setValue('/')
    await nextTick()

    const names = wrapper.findAllComponents(CommandRow).map((row) => row.props('command').name)
    expect(names).toContain('/settings')
    expect(names).toContain('/logout')
  })

  it('offers a go-to entry for a term that is really a url', async () => {
    const wrapper = await open()

    await wrapper.find('input').setValue('example.com')
    await nextTick()

    expect(wrapper.findComponent(SiteRow).props('site').url).toBe('https://example.com/')
  })
})

describe('the routes', () => {
  it('paints the portal for an address that names nothing', async () => {
    window.location.hash = '/nonsense'
    const wrapper = await open()

    expect(wrapper.findComponent(LauncherBar).exists()).toBe(true)
  })

  it('opens the admin panel when the address names it', async () => {
    const wrapper = await open()

    window.location.hash = '/admin'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await vi.waitFor(() => expect(wrapper.findComponent(ServiceCard).exists()).toBe(false))

    expect(wrapper.text()).toContain('diele')
  })

  // A denied account that lands on #/admin anyway is sent back rather than left on a route
  // that renders nothing.
  it('sends an account that may not configure back to the portal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)

        if (url.includes('/api/auth/me')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ id: 1, name: 'Ada', email: null, picture: null, canAdmin: false }),
            ),
          )
        }

        return stubApi()(input)
      }),
    )

    const wrapper = await open()
    window.location.hash = '/admin'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await vi.waitFor(() => expect(window.location.hash).toBe('#/'))

    expect(wrapper.findComponent(LauncherBar).exists()).toBe(true)
  })

  // The panel has nothing to paint without a session, so it hands the screen over rather than
  // carrying a sign-in of its own. What the portal cached is untouched, so backing out of the
  // gate still finds a front page.
  it('hands the screen to the gate when the admin session has lapsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes('/api/admin/')) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'authentication required' }), { status: 401 }),
          )
        }

        return stubApi()(input)
      }),
    )

    const wrapper = await open()
    window.location.hash = '/admin'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    await vi.waitFor(() => expect(wrapper.findComponent(LoginGate).exists()).toBe(true))

    expect(localStorage.getItem(CONFIG_CACHE_KEY)).not.toBeNull()
  })

  // A 403 is an account the panel turns away, which signing in again would not change, so it
  // keeps the panel and says why rather than handing the screen to a gate that would only loop.
  it('keeps the panel and says why when the admin api refuses rather than lapses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes('/api/admin/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: 'administration is not permitted for this account' }),
              { status: 403 },
            ),
          )
        }

        return stubApi()(input)
      }),
    )

    const wrapper = await open()
    window.location.hash = '/admin'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    await vi.waitFor(() => expect(wrapper.text()).toContain('may not configure'))

    expect(wrapper.findComponent(LoginGate).exists()).toBe(false)
    expect(sessionLapsed.value).toBe(false)
  })
})

describe('a session that lapses behind a cached portal', () => {
  /**
   * Fills the config cache the way a signed-in visit leaves it.
   * @returns {void}
   */
  function seedCache(): void {
    localStorage.setItem(
      CONFIG_CACHE_KEY,
      JSON.stringify({ storedAt: Date.now(), config: CONFIG, etag: 'W/"1"' }),
    )
  }

  /**
   * Answers every read that needs a session with a 401, the way the api does once it has ended.
   * @param {'local' | 'oidc'} mode - How the deployment signs people in
   * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
   */
  function stubLapsed(mode: 'local' | 'oidc' = 'local') {
    return vi.fn((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/auth/providers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              brand: CONFIG.brand,
              mode,
              setupRequired: false,
              providers: mode === 'oidc' ? [{ id: 'oidc', name: 'Single Sign-On' }] : [],
            }),
          ),
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify({ error: 'authentication required' }), { status: 401 }),
      )
    })
  }

  // This is a new tab page: last visit's tiles stay, and the line above them says why they may be
  // stale and how to fix it, rather than the page going quiet or throwing the user at a login.
  it('keeps painting the cached portal and says it is signed out', async () => {
    seedCache()
    vi.stubGlobal('fetch', stubLapsed())

    const wrapper = await open()

    await vi.waitFor(() =>
      expect(wrapper.findComponent(SignedOutBanner).text()).toContain('Signed out'),
    )
    expect(wrapper.findComponent(ServiceCard).exists()).toBe(true)
    expect(wrapper.findComponent(LoginGate).exists()).toBe(false)
  })

  it('says nothing while the session holds', async () => {
    const wrapper = await open()
    await vi.waitFor(() => expect(wrapper.findComponent(EntryRow).exists()).toBe(true))

    expect(wrapper.findComponent(SignedOutBanner).find('button').exists()).toBe(false)
  })

  // A cold start has nothing to keep painting, so it still opens on the gate.
  it('opens on the gate when nothing was cached', async () => {
    vi.stubGlobal('fetch', stubLapsed())

    const wrapper = mount(App, { attachTo: document.body })

    await vi.waitFor(() => expect(wrapper.findComponent(LoginGate).exists()).toBe(true))
    expect(wrapper.findComponent(SignedOutBanner).exists()).toBe(false)

    // ended on the gate, which the reset after each test would swap for a portal fetching
    // against a fetch already unstubbed
    wrapper.unmount()
  })

  // A password cannot be had by redirecting, so the gate's form comes up, over the cache rather
  // than by dropping it.
  it('opens the gate from the banner in local mode', async () => {
    seedCache()
    vi.stubGlobal('fetch', stubLapsed('local'))

    const wrapper = await open()
    await vi.waitFor(() =>
      expect(wrapper.findComponent(SignedOutBanner).find('button').exists()).toBe(true),
    )

    await wrapper.findComponent(SignedOutBanner).find('button').trigger('click')

    expect(wrapper.findComponent(LoginGate).exists()).toBe(true)
    expect(localStorage.getItem(CONFIG_CACHE_KEY)).not.toBeNull()

    wrapper.unmount()
  })

  // The issuer still holds its own session, so its redirect answers at once.
  it('goes straight to the issuer from the banner in oidc mode', async () => {
    const realLocation = window.location
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign, pathname: '/', search: '', hash: '' },
    })

    try {
      seedCache()
      vi.stubGlobal('fetch', stubLapsed('oidc'))

      const wrapper = await open()
      await vi.waitFor(() =>
        expect(wrapper.findComponent(SignedOutBanner).find('button').exists()).toBe(true),
      )
      // The mode is what picks the path, so it has to have answered before the press. Joins the
      // read App already started rather than sending another.
      await useSession().loadProviders()

      await wrapper.findComponent(SignedOutBanner).find('button').trigger('click')

      expect(assign).toHaveBeenCalledWith(expect.stringContaining('/api/auth/login?redirect='))
      expect(wrapper.findComponent(LoginGate).exists()).toBe(false)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    }
  })

  // Left in the background while the session ended, the tab says so the moment it is looked at
  // rather than whenever a poll next happens to answer.
  it('notices a lapse when the tab comes back to the front', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    try {
      const wrapper = await open()
      await vi.waitFor(() => expect(wrapper.findComponent(EntryRow).exists()).toBe(true))
      expect(wrapper.findComponent(SignedOutBanner).find('button').exists()).toBe(false)

      vi.stubGlobal('fetch', stubLapsed())
      vi.setSystemTime(Date.now() + 60_000)
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))

      await vi.waitFor(() =>
        expect(wrapper.findComponent(SignedOutBanner).find('button').exists()).toBe(true),
      )
      expect(wrapper.findComponent(ServiceCard).exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
