import type { ListAction } from '@/helpers/listActions'

export interface SettingsControls {
  /** Leaves the settings view */
  leave: () => void
  /** Ends the session and returns to the login screen */
  signOut: () => void
  /** Ends every session the account has, this browser's included */
  signOutEverywhere: () => void
  /** Who is signed in, so the sign-out row can name them */
  name: string | null
}

/**
 * Builds the rows that close the settings list.
 *
 * Signing out is last, because it is the one row here with a consequence beyond this browser:
 * it belongs where nothing is stepped through it by accident on the way to something else.
 * Signing out everywhere sits past it for the same reason, one step further.
 * @param {SettingsControls} controls - What each row does
 * @returns {ReadonlyArray<ListAction>} - The closing rows, in list order
 */
export function settingsActions(controls: SettingsControls): ReadonlyArray<ListAction> {
  return [
    {
      kind: 'action',
      id: 'leave',
      label: 'Back to the portal',
      description: 'leave the settings view',
      run: controls.leave,
    },
    {
      kind: 'action',
      id: 'signout',
      label: 'Sign out',
      description: controls.name ? `ends the session for ${controls.name}` : 'ends the session',
      run: controls.signOut,
    },
    {
      kind: 'action',
      id: 'signout-all',
      label: 'Sign out everywhere',
      description: 'ends every session, on this device and any other',
      run: controls.signOutEverywhere,
    },
  ]
}
