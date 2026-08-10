import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { ROUTES, adminSection, settingsSection } from '@/composables/routes'
import { useHashRoute } from '@/composables/useHashRoute'
import { withSetup } from '@tests/support/withSetup'

/**
 * Puts a path in the address bar and lets the listener catch up.
 * @param {string} path - Path to navigate to, without the hash
 * @returns {Promise<void>}
 */
async function navigate(path: string): Promise<void> {
  window.location.hash = path
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  await nextTick()
}

beforeEach(async () => {
  window.location.hash = ''
})

afterEach(() => {
  window.location.hash = ''
})

describe('routes', () => {
  // Restructuring or localising a segment is one file's business rather than every template
  // that spelled it out.
  it('builds every path from one place', () => {
    expect(ROUTES.portal).toBe('/')
    expect(adminSection('cards')).toBe('/admin/cards')
    expect(settingsSection('theme')).toBe('/settings/theme')
  })
})

describe('reading the hash', () => {
  it('reads an empty hash as the portal', () => {
    const { result, wrapper } = withSetup(() => useHashRoute())

    expect(result.route.value).toEqual({ name: 'portal' })
    expect(result.isAdmin.value).toBe(false)
    wrapper.unmount()
  })

  it('recognises the admin and settings routes', async () => {
    const { result, wrapper } = withSetup(() => useHashRoute())

    await navigate('/admin')
    expect(result.isAdmin.value).toBe(true)
    expect(result.section.value).toBeUndefined()

    await navigate('/settings')
    expect(result.isSettings.value).toBe(true)
    wrapper.unmount()
  })

  it('reads the section a path expands', async () => {
    const { result, wrapper } = withSetup(() => useHashRoute())

    await navigate(adminSection('cards'))
    expect(result.route.value).toEqual({ name: 'admin', section: 'cards' })

    await navigate(settingsSection('theme'))
    expect(result.route.value).toEqual({ name: 'settings', section: 'theme' })
    wrapper.unmount()
  })

  // A stale or hand-edited hash lands somewhere usable rather than on a blank page.
  it('reads anything unrecognised as the portal', async () => {
    const { result, wrapper } = withSetup(() => useHashRoute())

    for (const path of ['/nonsense', '/admins', '/', '/settings-old']) {
      await navigate(path)
      expect(result.route.value.name, path).toBe('portal')
    }

    wrapper.unmount()
  })

  it('normalises a hash written without its leading slash', async () => {
    const { result, wrapper } = withSetup(() => useHashRoute())

    await navigate('admin')
    expect(result.isAdmin.value).toBe(true)
    wrapper.unmount()
  })

  it('ignores extra segments past the section', async () => {
    const { result, wrapper } = withSetup(() => useHashRoute())

    await navigate('/admin/cards/extra/deeper')
    expect(result.route.value).toEqual({ name: 'admin', section: 'cards' })
    wrapper.unmount()
  })
})

describe('changing the route', () => {
  it('go puts the path in the address bar', async () => {
    const { result, wrapper } = withSetup(() => useHashRoute())

    result.go(ROUTES.admin)
    await nextTick()

    expect(window.location.hash).toBe('#/admin')
    expect(result.isAdmin.value).toBe(true)
    wrapper.unmount()
  })

  // Replace rather than push, so going back does not return to a route that redirected away.
  it('replace changes the route without adding a history entry', async () => {
    const { result, wrapper } = withSetup(() => useHashRoute())
    const before = window.history.length

    result.replace(ROUTES.settings)
    await nextTick()

    expect(result.isSettings.value).toBe(true)
    expect(window.history.length).toBe(before)
    wrapper.unmount()
  })
})

// The hash can have changed between module load and mount, e.g. a link opened in place.
it('picks up a hash that was already set before it mounted', async () => {
  window.location.hash = '/settings'

  const { result, wrapper } = withSetup(() => useHashRoute())
  await nextTick()

  expect(result.isSettings.value).toBe(true)
  wrapper.unmount()
})

// One listener however many components ask, and it goes when the last of them does.
it('keeps one listener for any number of callers', async () => {
  const first = withSetup(() => useHashRoute())
  const second = withSetup(() => useHashRoute())

  await navigate('/admin')
  expect(first.result.isAdmin.value).toBe(true)
  expect(second.result.isAdmin.value).toBe(true)

  first.wrapper.unmount()

  await navigate('/settings')
  expect(second.result.isSettings.value).toBe(true)

  second.wrapper.unmount()
})
