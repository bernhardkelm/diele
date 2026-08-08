import { describe, expect, it, vi } from 'vitest'
import { useAdminRowEdits } from '@/features/admin/useAdminRowEdits'

/**
 * Builds the composable with spies for every write and for the focus restore.
 * @param {boolean} accepted - Whether the writes report going through
 * @returns {object} - The edits plus the spies behind them
 */
function edits(accepted = true) {
  const create = vi.fn().mockResolvedValue(accepted)
  const update = vi.fn().mockResolvedValue(accepted)
  const remove = vi.fn().mockResolvedValue(accepted)
  const restore = vi.fn().mockResolvedValue(undefined)

  return {
    rows: useAdminRowEdits({ create, update, remove, restore }),
    create,
    update,
    remove,
    restore,
  }
}

describe('saving an edited row', () => {
  it('closes the form and puts focus back on the row', async () => {
    const { rows, update, restore } = edits()
    rows.editing.value = 'entry:1'

    await rows.saveEntry('entry:1', 1, { label: 'Grafana' })

    expect(update).toHaveBeenCalledWith(1, { label: 'Grafana' })
    expect(rows.editing.value).toBeUndefined()
    expect(restore).toHaveBeenCalledWith({ type: 'station', key: 'entry:1' })
  })

  // A save can be refused by the connector's own source rather than only by validation the form
  // could have done itself, and closing first would throw away everything typed on the way to
  // finding that out.
  it('leaves the form standing when the write was refused', async () => {
    const { rows, restore } = edits(false)
    rows.editing.value = 'entry:1'

    await rows.saveEntry('entry:1', 1, { label: 'Grafana' })

    expect(rows.editing.value).toBe('entry:1')
    expect(restore).not.toHaveBeenCalled()
  })
})

describe('adding a row', () => {
  // Entries are usually added in a run, so focus stays on the add line rather than following
  // the row that was just created.
  it('closes the form and leaves focus on the add line', async () => {
    const { rows, create, restore } = edits()
    rows.editing.value = 'add:links'

    await rows.addEntry('add:links', { label: 'New' })

    expect(create).toHaveBeenCalledWith({ label: 'New' })
    expect(rows.editing.value).toBeUndefined()
    expect(restore).toHaveBeenCalledWith({ type: 'station', key: 'add:links' })
  })

  it('keeps what was typed when the write was refused', async () => {
    const { rows, restore } = edits(false)
    rows.editing.value = 'add:links'

    await rows.addEntry('add:links', { label: 'New' })

    expect(rows.editing.value).toBe('add:links')
    expect(restore).not.toHaveBeenCalled()
  })
})

describe('deleting a row', () => {
  // The row that held focus is gone, so focus goes to whatever takes its place rather than to
  // a station key that no longer exists.
  it('leaves focus on the position rather than the row that is gone', async () => {
    const { rows, remove, restore } = edits()

    await rows.removeAt(7, 2)

    expect(remove).toHaveBeenCalledWith(7)
    expect(restore).toHaveBeenCalledWith({ type: 'position', index: 2 })
  })
})

describe('closing a form without saving', () => {
  it('puts focus back on the row the form belonged to', async () => {
    const { rows, restore, update } = edits()
    rows.editing.value = 'entry:1'

    await rows.cancelEdit('entry:1')

    expect(rows.editing.value).toBeUndefined()
    expect(update).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledWith({ type: 'station', key: 'entry:1' })
  })
})

// Every write reloads the rows wholesale, so by the time one resolves the element that held
// focus no longer exists.
describe('keeping focus across any write', () => {
  it('waits for the write before putting focus back', async () => {
    const { rows, restore } = edits()
    const order: string[] = []

    const write = Promise.resolve(true).then(() => {
      order.push('write')
      return true
    })
    restore.mockImplementation(async () => {
      order.push('restore')
    })

    await rows.keepFocus(write, 'entry:3')

    expect(order).toEqual(['write', 'restore'])
    expect(restore).toHaveBeenCalledWith({ type: 'station', key: 'entry:3' })
  })

  // The reorder and the enable switch both go through here and neither reports failure, so
  // focus is restored either way rather than being dropped to the document.
  it('puts focus back even when the write reports it did not go through', async () => {
    const { rows, restore } = edits()

    await rows.keepFocus(Promise.resolve(false), 'entry:3')

    expect(restore).toHaveBeenCalledWith({ type: 'station', key: 'entry:3' })
  })
})

it('opens with no form showing', () => {
  expect(edits().rows.editing.value).toBeUndefined()
})
