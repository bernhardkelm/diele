import { ref, type Ref } from 'vue'
import type { FocusIntent } from '@/composables/useStationRing'

export interface AdminRowEditsOptions {
  /** Each answers whether the write went through, which is what decides if the form closes */
  create: (values: Record<string, unknown>) => Promise<boolean>
  update: (id: number, values: Record<string, unknown>) => Promise<boolean>
  remove: (id: number) => Promise<boolean>
  /** Puts focus back once the list has been rebuilt */
  restore: (intent: FocusIntent) => Promise<void>
}

export interface AdminRowEdits {
  /** Station key of the row whose form is open, or undefined while none is */
  editing: Ref<string | undefined>
  /** Runs any write and puts focus back on a station once the list has been rebuilt */
  keepFocus: (write: Promise<unknown>, key: string) => Promise<void>
  removeAt: (id: number, index: number) => Promise<void>
  cancelEdit: (key: string) => Promise<void>
  saveEntry: (key: string, id: number, values: Record<string, unknown>) => Promise<void>
  addEntry: (key: string, values: Record<string, unknown>) => Promise<void>
}

/**
 * Wraps the admin writes with the focus handling each of them needs.
 *
 * Every write reloads the rows wholesale, so by the time a call resolves the element that held
 * focus no longer exists. Keeping that pairing in one place is what stops the list from
 * silently dropping the caret back to the document after an edit, which is the difference
 * between a panel that can be driven by keyboard and one that cannot.
 * @param {AdminRowEditsOptions} options - The writes and how to put focus back
 * @returns {AdminRowEdits} - Which form is open, and the writes that manage it
 */
export function useAdminRowEdits(options: AdminRowEditsOptions): AdminRowEdits {
  const editing = ref<string | undefined>()

  /**
   * Runs a write and puts focus back afterwards. Whatever the write answers is the caller's to
   * read: this only waits for it, so a write that reports nothing is as welcome as one that
   * reports whether it landed.
   * @param {Promise<unknown>} write - The call being made
   * @param {string} key - Station to focus once the list has been rebuilt
   * @returns {Promise<void>}
   */
  async function keepFocus(write: Promise<unknown>, key: string): Promise<void> {
    await write
    await options.restore({ type: 'station', key })
  }

  /**
   * Deletes a row and leaves focus on whatever takes its place, which is the row below it, or
   * whatever the list ends with once the last one is gone.
   * @param {number} id - Row to delete
   * @param {number} index - Position it held in the ring
   * @returns {Promise<void>}
   */
  async function removeAt(id: number, index: number): Promise<void> {
    await options.remove(id)
    await options.restore({ type: 'position', index })
  }

  /**
   * Closes an open form and puts focus back on the row it belonged to, which is otherwise lost
   * with the element the form was rendered into.
   * @param {string} key - Station the form was opened from
   * @returns {Promise<void>}
   */
  async function cancelEdit(key: string): Promise<void> {
    editing.value = undefined
    await options.restore({ type: 'station', key })
  }

  /**
   * Saves an edited row, closing its form only once the write is through.
   *
   * A save can now be refused by the connector's own source rather than only by validation the
   * form could have done itself, and closing first would throw away everything typed on the way
   * to finding that out.
   * @param {string} key - Station the row occupies
   * @param {number} id - Row being saved
   * @param {Record<string, unknown>} values - What the form holds
   * @returns {Promise<void>}
   */
  async function saveEntry(
    key: string,
    id: number,
    values: Record<string, unknown>,
  ): Promise<void> {
    if (!(await options.update(id, values))) {
      return
    }

    editing.value = undefined
    await options.restore({ type: 'station', key })
  }

  /**
   * Adds a row and leaves focus on the add line, since entries are usually added in a run. A
   * refused one leaves the form standing with what was typed in it.
   * @param {string} key - Station the add line occupies
   * @param {Record<string, unknown>} values - What the form holds
   * @returns {Promise<void>}
   */
  async function addEntry(key: string, values: Record<string, unknown>): Promise<void> {
    if (!(await options.create(values))) {
      return
    }

    editing.value = undefined
    await options.restore({ type: 'station', key })
  }

  return { editing, keepFocus, removeAt, cancelEdit, saveEntry, addEntry }
}
