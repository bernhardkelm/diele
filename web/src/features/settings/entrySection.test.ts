import { describe, expect, it, vi } from 'vitest'
import { entrySection, type EntryVisibility } from '@/features/settings/entrySection'
import type { RowTarget } from '@/types/portal'

const rows: ReadonlyArray<RowTarget> = [
  { ref: 'row:1', kind: 'row', name: 'web', url: 'https://g.test/web', detail: 'example-group' },
  { ref: 'row:2', kind: 'row', name: 'api', url: 'https://g.test/api', detail: 'example-group' },
  { ref: 'row:3', kind: 'row', name: 'lonely', url: 'https://g.test/lonely' },
]

/**
 * Builds the hidden set and controls a section reads.
 * @param {ReadonlyArray<string>} hidden - Refs this account hid from its own list
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
  // Keeping an entry from everyone is an administrative act, made in the admin panel under the
  // connector that produced it. Nothing here reaches it.
  it('decides this account own list and says so', () => {
    const section = entrySection(rows, visibility())

    expect(section.id).toBe('hidden')
    expect(section.label).toBe('Hidden entries')
    expect(section.description).toContain('your own list')
  })

  it('holds one switch per row, keyed by ref so a rename does not lose the choice', () => {
    const options = entrySection(rows, visibility()).options

    expect(options.map((option) => option.id)).toEqual(['row:1', 'row:2', 'row:3'])
  })

  it('labels a row by its namespace and name, and by name alone without one', () => {
    const options = entrySection(rows, visibility()).options

    expect(options[0]!.label).toBe('example-group/web')
    expect(options[2]!.label).toBe('lonely')
  })

  // A row is on when it is shown, so the switch reads as "in the list" rather than "hidden".
  it('reads a hidden row as off and says so', () => {
    const options = entrySection(rows, visibility(['row:2'])).options

    expect(options[0]).toMatchObject({ on: true, detail: 'shown in the list' })
    expect(options[1]).toMatchObject({ on: false, detail: 'kept out of the list' })
  })

  it('counts what is still shown in its trail', () => {
    expect(entrySection(rows, visibility()).trail).toBe('3/3')
    expect(entrySection(rows, visibility(['row:1', 'row:2'])).trail).toBe('1/3')
  })

  it('flips the row it was asked to', () => {
    const controls = visibility()
    entrySection(rows, controls).options[1]!.run()

    expect(controls.toggle).toHaveBeenCalledWith('row:2')
  })

  // On a list nothing has been taken out of, it would be a row that does nothing.
  it('offers the restore row only while something is hidden', () => {
    expect(entrySection(rows, visibility()).action).toBeUndefined()
    expect(entrySection(rows, visibility(['row:1'])).action).toBeDefined()
  })

  it('counts what the restore row would bring back, in the right plural', () => {
    expect(entrySection(rows, visibility(['row:1'])).action?.description).toBe(
      'brings back the 1 entry hidden here',
    )
    expect(entrySection(rows, visibility(['row:1', 'row:2'])).action?.description).toBe(
      'brings back the 2 entries hidden here',
    )
  })

  it('restores everything it hid', () => {
    const controls = visibility(['row:1'])
    entrySection(rows, controls).action!.run()

    expect(controls.showAll).toHaveBeenCalled()
  })

  it('copes with a portal that has no connector rows at all', () => {
    const empty = entrySection([], visibility())

    expect(empty.options).toEqual([])
    expect(empty.trail).toBe('0/0')
    expect(empty.action).toBeUndefined()
  })
})
