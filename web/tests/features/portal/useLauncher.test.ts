import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { shortcutFor, useLauncher, type LaunchTarget } from '@/features/portal/useLauncher'
import { withSetup } from '@tests/support/withSetup'

interface Target extends LaunchTarget {
  readonly tile?: boolean
}

/**
 * Builds a target the launcher can reach.
 * @param {string} name - Name, which is also its ref
 * @param {Partial<Target>} overrides - Fields to set on top of it
 * @returns {Target} - The target
 */
function target(name: string, overrides: Partial<Target> = {}): Target {
  return { ref: name, name, url: `https://${name}.test`, ...overrides }
}

const assign = vi.fn()
const open = vi.fn()

beforeEach(() => {
  assign.mockClear()
  open.mockClear()
  vi.stubGlobal('open', open)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign, href: 'http://portal.test/', pathname: '/', search: '', hash: '' },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Sends a key press to the window listener the launcher installs.
 * @param {string} key - Key name
 * @param {KeyboardEventInit} init - Modifiers and the physical code
 * @returns {KeyboardEvent} - The dispatched event, so a test can read defaultPrevented
 */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
  window.dispatchEvent(event)

  return event
}

describe('shortcutFor', () => {
  // Index 9 maps to '0', so the tenth entry stays reachable.
  it('numbers the first ten entries, the tenth as zero', () => {
    expect(shortcutFor(0)).toBe('1')
    expect(shortcutFor(8)).toBe('9')
    expect(shortcutFor(9)).toBe('0')
  })

  it('offers nothing past the tenth', () => {
    expect(shortcutFor(10)).toBeUndefined()
    expect(shortcutFor(-1)).toBeUndefined()
  })
})

describe('what the launcher matches', () => {
  // The resting page is the portal itself, so search-only entries stay out of it.
  it('leaves search-only entries off the resting page', () => {
    const { result, wrapper } = withSetup(() =>
      useLauncher([target('a'), target('b', { searchOnly: true })]),
    )

    expect(result.matches.value.map((t) => t.ref)).toEqual(['a'])
    wrapper.unmount()
  })

  it('falls back to a plain substring filter over name, url and keywords', async () => {
    const targets = [
      target('grafana'),
      target('kuma', { keywords: ['uptime'] }),
      target('other', { url: 'https://grafana.internal' }),
    ]
    const { result, wrapper } = withSetup(() => useLauncher(targets))

    result.query.value = 'grafana'
    await nextTick()
    expect(result.matches.value.map((t) => t.ref)).toEqual(['grafana', 'other'])

    result.query.value = 'uptime'
    await nextTick()
    expect(result.matches.value.map((t) => t.ref)).toEqual(['kuma'])
    wrapper.unmount()
  })

  it('uses the ranker it was given instead', async () => {
    const match = vi.fn(() => [target('ranked')])
    const { result, wrapper } = withSetup(() => useLauncher([target('a')], { match }))

    result.query.value = 'x'
    await nextTick()

    expect(match).toHaveBeenCalledWith([target('a')], 'x')
    expect(result.matches.value.map((t) => t.ref)).toEqual(['ranked'])
    wrapper.unmount()
  })

  // A term that produced one is a stronger signal than anything the term merely matched.
  it('puts targets derived from the term ahead of the ones it filtered', async () => {
    const { result, wrapper } = withSetup(() =>
      useLauncher([target('grafana')], { dynamicTargets: (term) => [target(`go:${term}`)] }),
    )

    result.query.value = 'grafana'
    await nextTick()

    expect(result.matches.value.map((t) => t.ref)).toEqual(['go:grafana', 'grafana'])
    wrapper.unmount()
  })
})

describe('the highlight', () => {
  // Enter prefers what the portal already knows over handing the term to a search engine.
  it('lands on the best match as soon as a term is typed', async () => {
    const { result, wrapper } = withSetup(() => useLauncher([target('a'), target('b')]))

    expect(result.hasSelection.value).toBe(false)

    result.query.value = 'a'
    await nextTick()

    expect(result.activeTarget.value?.ref).toBe('a')
    wrapper.unmount()
  })

  it('drops back to nothing when the term is cleared', async () => {
    const { result, wrapper } = withSetup(() => useLauncher([target('a')]))

    result.query.value = 'a'
    await nextTick()
    result.query.value = ''
    await nextTick()

    expect(result.hasSelection.value).toBe(false)
    expect(result.activeIndex.value).toBe(-1)
    wrapper.unmount()
  })

  // The selection is the target's ref, not its position: entries arrive after the first paint
  // and an index would leave the highlight on whatever slid into that slot.
  it('stays on its own entry when the list reorders underneath it', async () => {
    const targets = ref<Target[]>([target('a'), target('b')])
    const { result, wrapper } = withSetup(() => useLauncher(targets))

    result.query.value = ''
    result.move(1)
    result.move(1)
    expect(result.activeTarget.value?.ref).toBe('b')

    targets.value = [target('b'), target('a')]
    await nextTick()

    expect(result.activeTarget.value?.ref).toBe('b')
    expect(result.activeIndex.value).toBe(0)
    wrapper.unmount()
  })

  it('repairs a selection whose entry has gone away', async () => {
    const targets = ref<Target[]>([target('a'), target('b')])
    const { result, wrapper } = withSetup(() => useLauncher(targets))

    result.query.value = 'b'
    await nextTick()
    expect(result.activeTarget.value?.ref).toBe('b')

    targets.value = [target('b2'), target('b3')]
    await nextTick()

    expect(result.activeTarget.value?.ref).toBe('b2')
    wrapper.unmount()
  })

  it('reads a selection whose entry is gone as no selection at all', async () => {
    const targets = ref<Target[]>([target('a')])
    const { result, wrapper } = withSetup(() => useLauncher(targets))

    result.move(1)
    expect(result.hasSelection.value).toBe(true)

    targets.value = []
    await nextTick()

    expect(result.hasSelection.value).toBe(false)
    wrapper.unmount()
  })
})

describe('moving through a list', () => {
  it('enters the list from either end', () => {
    const { result, wrapper } = withSetup(() =>
      useLauncher([target('a'), target('b'), target('c')]),
    )

    result.move(1)
    expect(result.activeIndex.value).toBe(0)

    result.clear()
    result.move(-1)
    expect(result.activeIndex.value).toBe(2)
    wrapper.unmount()
  })

  // The search field is a station in the ring rather than an edge: stepping past either end
  // drops the highlight and hands Enter back to the engine.
  it('drops the highlight when stepping past either end', () => {
    const { result, wrapper } = withSetup(() => useLauncher([target('a'), target('b')]))

    result.move(1)
    result.move(1)
    result.move(1)
    expect(result.hasSelection.value).toBe(false)

    result.move(-1)
    expect(result.activeIndex.value).toBe(1)
    wrapper.unmount()
  })

  it('does nothing at all with an empty list', () => {
    const { result, wrapper } = withSetup(() => useLauncher([] as Target[]))

    result.move(1)

    expect(result.hasSelection.value).toBe(false)
    wrapper.unmount()
  })
})

describe('moving through a tile grid', () => {
  const tiles = [
    target('t0', { tile: true }),
    target('t1', { tile: true }),
    target('t2', { tile: true }),
    target('t3', { tile: true }),
    target('t4', { tile: true }),
    target('row'),
  ]

  /**
   * Builds a launcher whose tiles walk as a grid.
   * @param {number} columns - Tiles per row
   * @returns {ReturnType<typeof withSetup>} - The mounted launcher
   */
  function grid(columns: number) {
    return withSetup(() =>
      useLauncher(tiles, { isTile: (t) => t.tile === true, tileColumns: columns }),
    )
  }

  it('steps a whole row down rather than one tile', () => {
    const { result, wrapper } = grid(3)

    result.move(1)
    expect(result.activeIndex.value).toBe(0)

    result.move(1)
    expect(result.activeIndex.value).toBe(3)
    wrapper.unmount()
  })

  // A partial last row would otherwise swallow the step.
  it('lands on the entry just past the grid when a step overshoots', () => {
    const { result, wrapper } = grid(3)

    result.move(1)
    result.move(1)
    expect(result.activeIndex.value).toBe(3)

    result.move(1)
    expect(result.activeIndex.value).toBe(5)
    wrapper.unmount()
  })

  it('leaves the grid upwards onto the entry just before it', () => {
    const withLead = [target('lead'), ...tiles]
    const { result, wrapper } = withSetup(() =>
      useLauncher(withLead, { isTile: (t) => t.tile === true, tileColumns: 3 }),
    )

    result.move(1)
    result.move(1)
    expect(result.activeIndex.value).toBe(1)

    result.move(-1)
    expect(result.activeIndex.value).toBe(0)
    wrapper.unmount()
  })

  // A sideways key never leaves the tiles for a row.
  it('walks tiles sideways and stops at the ends of the grid', () => {
    const { result, wrapper } = grid(3)

    result.move(1)
    result.moveColumn(1)
    expect(result.activeIndex.value).toBe(1)

    result.moveColumn(-1)
    expect(result.activeIndex.value).toBe(0)

    result.moveColumn(-1)
    expect(result.activeIndex.value).toBe(0)
    wrapper.unmount()
  })

  // Under two columns there is no grid to walk, so the tiles behave as a list.
  it('walks tiles as a list when the layout is one column wide', () => {
    const { result, wrapper } = grid(1)

    result.move(1)
    result.move(1)
    expect(result.activeIndex.value).toBe(1)
    wrapper.unmount()
  })
})

describe('moving between a row actions', () => {
  const actions = [
    { href: 'https://a.test' },
    { href: 'https://b.test' },
    { href: 'https://c.test' },
  ]

  it('wraps past either end', () => {
    const { result, wrapper } = withSetup(() =>
      useLauncher([target('a')], { actionsOf: () => actions }),
    )

    result.move(1)
    expect(result.activeAction.value).toBe(0)

    result.moveColumn(1)
    expect(result.activeAction.value).toBe(1)

    result.moveColumn(-1)
    result.moveColumn(-1)
    expect(result.activeAction.value).toBe(2)
    wrapper.unmount()
  })

  it('does nothing on a row with only its own link', () => {
    const { result, wrapper } = withSetup(() => useLauncher([target('a')]))

    result.move(1)
    result.moveColumn(1)

    expect(result.activeAction.value).toBe(0)
    wrapper.unmount()
  })

  // A different entry starts on its own default action rather than inheriting a column.
  // The reset runs in a watcher, so it lands on the tick after the highlight moved.
  it('resets to the default action when the highlight moves', async () => {
    const { result, wrapper } = withSetup(() =>
      useLauncher([target('a'), target('b')], { actionsOf: () => actions }),
    )

    result.move(1)
    result.moveColumn(1)
    expect(result.activeAction.value).toBe(1)

    result.move(1)
    await nextTick()
    expect(result.activeAction.value).toBe(0)
    wrapper.unmount()
  })
})

describe('launching', () => {
  // The portal is itself a new tab page, so opening in place is the default.
  it('opens in place, and alongside only when asked', () => {
    const { result, wrapper } = withSetup(() => useLauncher([target('a')]))

    result.launch(target('a'))
    expect(assign).toHaveBeenCalledWith('https://a.test')

    result.launch(target('a'), true)
    expect(open).toHaveBeenCalledWith('https://a.test', '_blank', 'noopener')
    wrapper.unmount()
  })

  it('reports the launch before navigating away', () => {
    const onLaunch = vi.fn()
    const { result, wrapper } = withSetup(() => useLauncher([target('a')], { onLaunch }))

    result.launch(target('a'))

    expect(onLaunch).toHaveBeenCalledWith(target('a'))
    wrapper.unmount()
  })

  it('does nothing without a target', () => {
    const { result, wrapper } = withSetup(() => useLauncher([target('a')]))

    result.launch(undefined)
    result.launchActive()

    expect(assign).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens the action the arrows selected', () => {
    const actions = [{ href: 'https://default.test' }, { href: 'https://second.test' }]
    const { result, wrapper } = withSetup(() =>
      useLauncher([target('a')], { actionsOf: () => actions }),
    )

    result.move(1)
    result.moveColumn(1)
    result.launchActive()

    expect(assign).toHaveBeenCalledWith('https://second.test')
    wrapper.unmount()
  })

  // Resolved before the launch is reported: a listener feeding the ranking would otherwise
  // reorder the matches under the selection and open whatever slid into its place.
  it('resolves the action before telling anyone the launch happened', () => {
    const targets = ref<Target[]>([target('a'), target('b')])
    const onLaunch = vi.fn(() => {
      targets.value = [target('b'), target('a')]
    })
    const { result, wrapper } = withSetup(() => useLauncher(targets, { onLaunch }))

    result.move(1)
    result.launchActive()

    expect(assign).toHaveBeenCalledWith('https://a.test')
    wrapper.unmount()
  })
})

describe('the global keys', () => {
  it('walks the list with the arrows and clears on escape', async () => {
    const { result, wrapper } = withSetup(() => useLauncher([target('a'), target('b')]))

    expect(press('ArrowDown').defaultPrevented).toBe(true)
    expect(result.activeIndex.value).toBe(0)

    press('ArrowDown')
    expect(result.activeIndex.value).toBe(1)

    press('ArrowUp')
    expect(result.activeIndex.value).toBe(0)

    result.query.value = 'a'
    await nextTick()
    press('Escape')
    expect(result.query.value).toBe('')
    expect(result.hasSelection.value).toBe(false)
    wrapper.unmount()
  })

  // Only steal the horizontal arrows once an entry is picked, so they stay caret keys for the
  // search input the rest of the time.
  it('leaves the sideways arrows to the caret while nothing is picked', () => {
    const actions = [{ href: 'https://a.test' }, { href: 'https://b.test' }]
    const { result, wrapper } = withSetup(() =>
      useLauncher([target('a')], { actionsOf: () => actions }),
    )

    expect(press('ArrowRight').defaultPrevented).toBe(false)

    result.move(1)
    expect(press('ArrowRight').defaultPrevented).toBe(true)
    expect(result.activeAction.value).toBe(1)
    wrapper.unmount()
  })

  // The physical key is read, because Alt rewrites event.key to a symbol on macOS layouts.
  it('opens one of the first ten by its digit, read from the physical key', () => {
    const { result, wrapper } = withSetup(() => useLauncher([target('a'), target('b')]))

    expect(press('†', { altKey: true, code: 'Digit2' }).defaultPrevented).toBe(true)

    expect(assign).toHaveBeenCalledWith('https://b.test')
    expect(result.hasSelection.value).toBe(false)
    wrapper.unmount()
  })

  it('counts only the entries that carry a badge', () => {
    const targets = [target('row'), target('card', { tile: true })]
    const { wrapper } = withSetup(() =>
      useLauncher(targets, { hasShortcut: (t) => t.tile === true }),
    )

    press('1', { altKey: true, code: 'Digit1' })

    expect(assign).toHaveBeenCalledWith('https://card.test')
    wrapper.unmount()
  })

  // AltGr reports as ctrl with alt on Windows layouts, and a chord the portal does not claim
  // belongs to the browser or the system.
  it('ignores a digit pressed with any other modifier', () => {
    const { wrapper } = withSetup(() => useLauncher([target('a')]))

    for (const init of [
      { altKey: true, ctrlKey: true },
      { altKey: true, metaKey: true },
      { altKey: true, shiftKey: true },
      { ctrlKey: true },
      { metaKey: true },
    ]) {
      press('1', { code: 'Digit1', ...init })
    }

    expect(assign).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  // The listener is on the window, so it outlives the view that owns it: without this its
  // arrows would still be driving a list nobody can see.
  it('ignores every key while the launcher is not the view on screen', () => {
    const enabled = ref(false)
    const { result, wrapper } = withSetup(() => useLauncher([target('a')], { enabled }))

    press('ArrowDown')
    press('1', { altKey: true, code: 'Digit1' })
    expect(result.hasSelection.value).toBe(false)
    expect(assign).not.toHaveBeenCalled()

    enabled.value = true
    press('ArrowDown')
    expect(result.hasSelection.value).toBe(true)
    wrapper.unmount()
  })

  it('stops listening once the view is gone', () => {
    const { result, wrapper } = withSetup(() => useLauncher([target('a')]))
    wrapper.unmount()

    press('ArrowDown')

    expect(result.hasSelection.value).toBe(false)
  })
})
