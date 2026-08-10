import { describe, expect, it, vi } from 'vitest'
import { adminSettingsActions } from '@/features/admin/adminSettingsActions'

const CONTROLS = {
  exportSettings: vi.fn(),
  pickImportFile: vi.fn(),
  leave: vi.fn(),
  busy: false,
}

describe('the rows that close the admin list', () => {
  it('offers export, import and the way out, in that order', () => {
    expect(adminSettingsActions(CONTROLS).map((action) => action.id)).toEqual([
      'export',
      'import',
      'leave',
    ])
  })

  // A trail is a word wide, and an import answers with a count per kind. Putting it there also
  // put an import's answer on the export row, which is not the row that ran it.
  it('puts no transfer result in either row trail', () => {
    for (const action of adminSettingsActions(CONTROLS)) {
      expect(action.trail, action.id).toBeUndefined()
    }
  })

  it('disables both transfers while one is in flight, never the way out', () => {
    const actions = adminSettingsActions({ ...CONTROLS, busy: true })

    expect(actions.map((action) => Boolean(action.disabled))).toEqual([true, true, false])
  })
})
