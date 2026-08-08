import { describe, expect, it, vi } from 'vitest'
import { entrySection, type EntryVisibility } from '@/features/settings/entrySection'
import type { RowTarget } from '@/types/portal'

const rows: ReadonlyArray<RowTarget> = [
  { ref: 'row:1', kind: 'row', name: 'web', url: 'https://g.test/web', detail: 'example-group' },
  { ref: 'row:2', kind: 'row', name: 'api', url: 'https://g.test/api', detail: 'example-group' },
  { ref: 'row:3', kind: 'row', name: 'lonely', url: 'https://g.test/lonely' },
]

/**
 * Builds the hidden sets and controls a section reads.
 * @param {ReadonlyArray<string>} hidden - Refs hidden in the scope under test
 * @returns {EntryVisibility} - The controls, with spies on the writes
 */
function visibility(hidden: ReadonlyArray<string> = []): EntryVisibility {
  return {
    isHiddenIn: (ref) => hidden.includes(ref),
    toggle: vi.fn().mockResolvedValue(undefined),
    showAll: vi.fn().mockResolvedValue(undefined),
  }
}

describe('entrySection', () => {
  // Hiding for yourself and hiding for everyone are the same act at different reach, so one
  // grammar serves both rather than the second needing a list of its own.
  it('names itself after the scope it decides', () => {
    expect(entrySection(rows, 'mine', visibility()).id).toBe('hidden')
    expect(entrySection(rows, 'mine', visibility()).label).toBe('Hidden entries')
    expect(entrySection(rows, 'all', visibility()).id).toBe('hidden-all')
    expect(entrySection(rows, 'all', visibility()).label).toBe('Hidden for everyone')
  })

  it('holds one switch per row, keyed by ref so a rename does not lose the choice', () => {
    const options = entrySection(rows, 'mine', visibility()).options

    expect(options.map((option) => option.id)).toEqual(['row:1', 'row:2', 'row:3'])
  })

  it('labels a row by its namespace and name, and by name alone without one', () => {
    const options = entrySection(rows, 'mine', visibility()).options

    expect(options[0]!.label).toBe('example-group/web')
    expect(options[2]!.label).toBe('lonely')
  })

  // A row is on when it is shown, so the switch reads as "in the list" rather than "hidden".
  it('reads a hidden row as off and says so', () => {
    const options = entrySection(rows, 'mine', visibility(['row:2'])).options

    expect(options[0]).toMatchObject({ on: true, detail: 'shown in the list' })
    expect(options[1]).toMatchObject({ on: false, detail: 'kept out of the list' })
  })

  it('counts what is still shown in its trail', () => {
    expect(entrySection(rows, 'mine', visibility()).trail).toBe('3/3')
    expect(entrySection(rows, 'mine', visibility(['row:1', 'row:2'])).trail).toBe('1/3')
  })

  it('flips the row it was asked to, in its own scope', () => {
    const controls = visibility()
    entrySection(rows, 'all', controls).options[1]!.run()

    expect(controls.toggle).toHaveBeenCalledWith('row:2', 'all')
  })

  // On a list nothing has been taken out of, it would be a row that does nothing.
  it('offers the restore row only while something is hidden', () => {
    expect(entrySection(rows, 'mine', visibility()).action).toBeUndefined()
    expect(entrySection(rows, 'mine', visibility(['row:1'])).action).toBeDefined()
  })

  it('counts what the restore row would bring back, in the right plural', () => {
    expect(entrySection(rows, 'mine', visibility(['row:1'])).action?.description).toBe(
      'brings back the 1 entry hidden here',
    )
    expect(entrySection(rows, 'mine', visibility(['row:1', 'row:2'])).action?.description).toBe(
      'brings back the 2 entries hidden here',
    )
  })

  it('restores in its own scope', () => {
    const controls = visibility(['row:1'])
    entrySection(rows, 'all', controls).action!.run()

    expect(controls.showAll).toHaveBeenCalledWith('all')
  })

  it('copes with a portal that has no connector rows at all', () => {
    const empty = entrySection([], 'mine', visibility())

    expect(empty.options).toEqual([])
    expect(empty.trail).toBe('0/0')
    expect(empty.action).toBeUndefined()
  })
})
