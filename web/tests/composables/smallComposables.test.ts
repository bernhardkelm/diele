import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
import { useAltHeld } from '@/composables/useAltHeld'
import { useCollapseToStation } from '@/composables/useCollapseToStation'
import { useGridColumns } from '@/composables/useGridColumns'
import { useStationRow } from '@/composables/useStationRow'
import { useVisibilityChange } from '@/composables/useVisibilityChange'
import { withSetup } from '@tests/support/withSetup'

describe('useAltHeld', () => {
  it('follows the key that reveals the badges', () => {
    const { result } = withSetup(() => useAltHeld())

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }))
    expect(result.value).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false }))
    expect(result.value).toBe(false)
  })

  // The same chord the shortcuts answer to, so the badges never offer one that is not live.
  it('stays down for a chord the shortcuts do not answer to', () => {
    const { result } = withSetup(() => useAltHeld())

    for (const init of [
      { altKey: true, ctrlKey: true },
      { altKey: true, metaKey: true },
      { altKey: true, shiftKey: true },
    ]) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', ...init }))
      expect(result.value, JSON.stringify(init)).toBe(false)
    }
  })

  // Releasing Alt outside the page never reaches the keyup listener and would otherwise
  // strand the badges on screen.
  it('clears when the page stops receiving keys', () => {
    const { result } = withSetup(() => useAltHeld())

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }))
    expect(result.value).toBe(true)

    window.dispatchEvent(new Event('blur'))
    expect(result.value).toBe(false)
  })

  it('stops listening once the view is gone', () => {
    const { result, wrapper } = withSetup(() => useAltHeld())
    wrapper.unmount()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }))

    expect(result.value).toBe(false)
  })
})

describe('useVisibilityChange', () => {
  it('reports whether the tab is now hidden', () => {
    const onChange = vi.fn()
    withSetup(() => useVisibilityChange(onChange))

    document.dispatchEvent(new Event('visibilitychange'))

    expect(onChange).toHaveBeenCalledWith(document.hidden)
  })

  it('takes its listener down with the component', () => {
    const onChange = vi.fn()
    const { wrapper } = withSetup(() => useVisibilityChange(onChange))
    wrapper.unmount()

    document.dispatchEvent(new Event('visibilitychange'))

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('useGridColumns', () => {
  // `auto-fit` resolves its track count at layout time, so the used value is the only place
  // the number exists.
  it('counts the resolved pixel tracks', async () => {
    const element = document.createElement('div')
    element.style.gridTemplateColumns = '100px 100px 100px'
    document.body.append(element)

    const { result } = withSetup(() => useGridColumns(shallowRef(element)))
    await nextTick()

    expect(result.value).toBe(3)
    element.remove()
  })

  // Anything still carrying a declaration counts as unmeasurable.
  it('falls back to a single column when there is nothing measurable', async () => {
    const declared = document.createElement('div')
    declared.style.gridTemplateColumns = 'repeat(auto-fit, minmax(140px, 1fr))'
    document.body.append(declared)

    const { result } = withSetup(() => useGridColumns(shallowRef(declared)))
    await nextTick()
    expect(result.value).toBe(1)

    const { result: none } = withSetup(() => useGridColumns(shallowRef(null)))
    await nextTick()
    expect(none.value).toBe(1)

    declared.remove()
  })

  it('re-measures when the element itself comes and goes', async () => {
    const element = document.createElement('div')
    element.style.gridTemplateColumns = '50px 50px'
    document.body.append(element)

    const target = shallowRef<HTMLElement | null>(null)
    const { result } = withSetup(() => useGridColumns(target))
    await nextTick()
    expect(result.value).toBe(1)

    target.value = element
    await nextTick()
    expect(result.value).toBe(2)

    element.remove()
  })
})

describe('useCollapseToStation', () => {
  const stations = ref([{ key: 'section:a' }, { key: 'section:b' }])

  // Focus moves first and the route follows, so there is never a moment with focus on an
  // element that has gone.
  it('puts the caret on the row being closed before leaving', () => {
    const order: string[] = []
    const focusAt = vi.fn((index: number) => order.push(`focus:${index}`))
    const leave = vi.fn(() => order.push('leave'))

    const collapse = useCollapseToStation(stations, focusAt, (id) => `section:${id}`, leave)
    collapse('b')

    expect(focusAt).toHaveBeenCalledWith(1)
    expect(order).toEqual(['focus:1', 'leave'])
  })

  it('still leaves when the row it would focus is gone', () => {
    const focusAt = vi.fn()
    const leave = vi.fn()

    useCollapseToStation(stations, focusAt, (id) => `section:${id}`, leave)('missing')

    expect(focusAt).not.toHaveBeenCalled()
    expect(leave).toHaveBeenCalled()
  })
})

describe('useStationRow', () => {
  // Every row in the ring is addressable the same way, which is what stops one becoming
  // unreachable by differing in a detail nobody would look at.
  it('makes the row addressable and gives it its depth', () => {
    const { attrs } = useStationRow({
      stationKey: () => 'feature:cards',
      active: () => false,
      level: 1,
    })

    expect(attrs.value).toEqual({
      role: 'treeitem',
      'aria-level': 1,
      'data-station': 'feature:cards',
      tabindex: -1,
    })
  })

  // Tabbing into the panel lands on the row the arrows left rather than walking the whole list.
  it('makes only the active row the list tab stop', () => {
    const active = ref(false)
    const { attrs } = useStationRow({ stationKey: () => 'k', active: () => active.value, level: 2 })

    expect(attrs.value.tabindex).toBe(-1)

    active.value = true
    expect(attrs.value.tabindex).toBe(0)
    expect(attrs.value['aria-level']).toBe(2)
  })

  // A `d` typed into a form field must not disable the row that field belongs to.
  it('only owns an event fired on the row itself', () => {
    const { ownsEvent } = useStationRow({ stationKey: () => 'k', active: () => true, level: 1 })
    const row = document.createElement('li')
    const field = document.createElement('input')
    row.append(field)

    expect(ownsEvent({ target: row, currentTarget: row } as unknown as Event)).toBe(true)
    expect(ownsEvent({ target: field, currentTarget: row } as unknown as Event)).toBe(false)
  })
})
