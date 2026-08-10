import type { ListAction } from '@/helpers/listActions'

export interface AdminSettingsControls {
  /** Downloads everything as a file */
  exportSettings: () => void
  /** Opens the file picker an import reads from */
  pickImportFile: () => void
  /** Leaves admin mode */
  leave: () => void
  /** True while an export or import is in flight, which disables both */
  busy: boolean
}

/**
 * Builds the rows that close the admin list.
 *
 * A fixed order after the features, because what the list ends with is what someone scrolling
 * to the bottom is looking for. Built here rather than inline in the view, the same way the
 * settings view composes its own closing rows.
 *
 * Neither row carries what the last transfer said. A trail is a word wide - the other lists put
 * `device` and `2/3` there - and an import answers with a count per kind, which belongs on a
 * line of its own rather than squeezed into the row above the one that ran it.
 * @param {AdminSettingsControls} controls - What each row does and whether it can right now
 * @returns {ReadonlyArray<ListAction>} - The closing rows, in list order
 */
export function adminSettingsActions(controls: AdminSettingsControls): ReadonlyArray<ListAction> {
  return [
    {
      kind: 'action',
      id: 'export',
      label: 'Export settings',
      description: 'download everything as a file; credentials ride along encrypted',
      disabled: controls.busy,
      run: controls.exportSettings,
    },
    {
      kind: 'action',
      id: 'import',
      label: 'Import settings',
      description: 'replace everything with a file from an export',
      disabled: controls.busy,
      run: controls.pickImportFile,
    },
    {
      kind: 'action',
      id: 'leave',
      label: 'Back to the portal',
      description: 'leave admin mode',
      run: controls.leave,
    },
  ]
}
