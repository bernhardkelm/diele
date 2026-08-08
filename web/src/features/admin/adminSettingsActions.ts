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
  /** What the last transfer said, shown in the export row's trail; omitted when it failed */
  message?: string
}

/**
 * Builds the rows that close the admin list.
 *
 * A fixed order after the features, because what the list ends with is what someone scrolling
 * to the bottom is looking for. Built here rather than inline in the view, the same way the
 * settings view composes its own closing rows.
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
      trail: controls.message,
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
